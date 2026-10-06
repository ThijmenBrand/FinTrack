/**
 * Notifications end to end against a real (temp) database, with the push
 * service and the mail provider replaced by recorders: the ledger dedupes,
 * preferences and locks are honoured, dead subscriptions are dropped, and the
 * evaluators raise what the data says.
 */
import { createECDH, randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setupTestDb } from "./test-db";

const pushed = vi.hoisted(() => [] as { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[]);
const gone = vi.hoisted(() => new Set<string>());
const mailed = vi.hoisted(() => [] as { to: string; event: string }[]);

vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(public statusCode: number) {
      super("push failed");
    }
  }
  return {
    WebPushError,
    default: {
      sendNotification: async (sub: { endpoint: string }, body: string) => {
        if (gone.has(sub.endpoint)) throw new WebPushError(410);
        pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
        return { statusCode: 201 };
      },
    },
  };
});

vi.mock("@/lib/email", () => ({
  sendBankSecurityEmail: async (to: string, event: string) => {
    mailed.push({ to, event });
  },
}));

process.env.VAPID_PUBLIC_KEY = "test-public";
process.env.VAPID_PRIVATE_KEY = "test-private";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("notifications");

const { dispatch, draft } = await import("@/lib/notifications/dispatch");
const { setNotificationPreference } = await import("@/lib/notifications/preferences");
const { saveSubscription, listDevices, MAX_DEVICES } = await import("@/lib/notifications/devices");
const { notifySignIn } = await import("@/lib/notifications/security");
const { evaluateNotifications } = await import("@/lib/notifications/evaluate");
const { notifyBankEvent } = await import("@/lib/bank-sync/notify");

const ME = "notify-me";
const OTHER = "notify-other";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/me-1";
// Generated per run: a subscription's keys are a P-256 public key and 16
// random bytes, base64url.
const keys = {
  p256dh: createECDH("prime256v1").generateKeys("base64url"),
  auth: randomBytes(16).toString("base64url"),
};

const exec = (sql: string, args: (string | number | null)[] = []) => testDb.client.execute({ sql, args });
const rows = async (sql: string, args: (string | number | null)[] = []) =>
  (await exec(sql, args)).rows as unknown as Record<string, unknown>[];
const now = () => new Date().toISOString();
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const overDraft = (category = "c-food", name = "Groceries") =>
  draft(
    "budget.over",
    { planId: null, categoryId: category, categoryName: name, spent: 512, limit: 450, monthStart: "2026-10-01" },
    `budget.over:none:${category}:2026-10-01`,
  );

beforeEach(async () => {
  await testDb.reset();
  pushed.length = 0;
  mailed.length = 0;
  gone.clear();
  await exec(`INSERT INTO "user" (id, name, email) VALUES (?, 'Me', 'me@example.com'), (?, 'Other', 'other@example.com')`, [ME, OTHER]);
  await saveSubscription(ME, { endpoint: ENDPOINT, ...keys }, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36");
});
afterAll(() => testDb.cleanup());

describe("dispatch", () => {
  it("sends a notification once, however often it is raised", async () => {
    expect(await dispatch(ME, [overDraft()])).toBe(1);
    expect(await dispatch(ME, [overDraft()])).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: "Groceries is over budget", url: "/budgets" });
    expect(await rows("SELECT pushed_at FROM notifications WHERE user_id = ?", [ME])).toEqual([
      { pushed_at: expect.any(String) },
    ]);
  });

  it("words it in the user's language", async () => {
    await exec(`INSERT INTO user_preferences (id, user_id, locale, created_at, updated_at) VALUES ('p', ?, 'nl', ?, ?)`, [ME, now(), now()]);
    await dispatch(ME, [overDraft()]);
    expect(pushed[0].payload.title).toBe("Groceries is over budget");
    expect(pushed[0].payload.body).toMatch(/uitgegeven van/);
  });

  it("records but doesn't send a type the user turned off", async () => {
    expect(await setNotificationPreference(ME, "budget.over", "push", false)).toBe("ok");
    expect(await dispatch(ME, [overDraft()])).toBe(1);
    expect(pushed).toHaveLength(0);
  });

  it("folds several of one type into a single message", async () => {
    await dispatch(ME, [overDraft("a", "Groceries"), overDraft("b", "Eating out"), overDraft("c", "Fuel"), overDraft("d", "Gifts")]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: "4 budgets are over", body: "Groceries, Eating out and 2 more" });
  });

  it("drops a subscription the push service says is gone", async () => {
    gone.add(ENDPOINT);
    await dispatch(ME, [overDraft()]);
    expect(await listDevices(ME)).toEqual([]);
  });
});

describe("security email", () => {
  it("can't be switched off, while its push can", async () => {
    expect(await setNotificationPreference(ME, "security.bank", "email", false)).toBe("locked");
    // Even a stored override (written around the API) doesn't silence it.
    await exec(
      `INSERT INTO notification_preferences (id, user_id, type, channel, enabled, updated_at) VALUES ('x', ?, 'security.bank', 'email', 0, ?)`,
      [ME, now()],
    );
    expect(await setNotificationPreference(ME, "security.bank", "push", false)).toBe("ok");
    await notifyBankEvent(ME, "bankConnected", { bank: "ING" });
    expect(mailed).toEqual([{ to: "me@example.com", event: "bankConnected" }]);
    expect(pushed).toHaveLength(0);
  });

  it("goes out for every occurrence", async () => {
    await notifyBankEvent(ME, "bankDisconnected", { bank: "ING" });
    await notifyBankEvent(ME, "bankDisconnected", { bank: "ING" });
    expect(mailed).toHaveLength(2);
    expect(pushed).toHaveLength(2);
  });

  it("refuses a channel the type doesn't have", async () => {
    expect(await setNotificationPreference(ME, "budget.over", "email", true)).toBe("unsupported");
  });
});

describe("devices", () => {
  it("moves a browser to whoever registers it now", async () => {
    await saveSubscription(OTHER, { endpoint: ENDPOINT, ...keys }, null);
    expect(await listDevices(ME)).toEqual([]);
    expect(await listDevices(OTHER)).toHaveLength(1);
  });

  it("keeps at most MAX_DEVICES, dropping the oldest", async () => {
    for (let i = 2; i <= MAX_DEVICES + 1; i++) {
      await saveSubscription(ME, { endpoint: `https://fcm.googleapis.com/fcm/send/me-${i}`, ...keys }, null);
    }
    const devices = await listDevices(ME);
    expect(devices).toHaveLength(MAX_DEVICES);
    const endpoints = await rows("SELECT endpoint FROM push_subscriptions WHERE user_id = ?", [ME]);
    expect(endpoints.map((r) => r.endpoint)).not.toContain(ENDPOINT);
  });
});

describe("notifySignIn", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  it("learns the first device quietly and speaks up for a new one", async () => {
    await notifySignIn(ME, mac);
    await notifySignIn(ME, mac);
    expect(pushed).toHaveLength(0);
    await notifySignIn(ME, iphone);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: "New sign-in to FinTrack" });
    expect(pushed[0].payload.body).toContain("Safari · iPhone");
    await notifySignIn(ME, iphone);
    expect(pushed).toHaveLength(1);
  });
});

describe("evaluateNotifications", () => {
  async function account(id: string, initialBalance: number) {
    await exec(
      `INSERT INTO accounts (id, user_id, name, type, initial_balance, created_at, updated_at) VALUES (?, ?, ?, 'checking', ?, ?, ?)`,
      [id, ME, `Account ${id}`, initialBalance, now(), now()],
    );
  }

  it("warns when an account won't cover a bill due tomorrow", async () => {
    await account("acc-1", 300);
    await exec(
      `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, day_of_month, start_date, is_active, match_field, created_at)
       VALUES ('rent', ?, 'acc-1', 'Rent', -1200, 'expense', 'monthly', ?, '2020-01-01', 1, 'name', ?)`,
      [ME, Number(iso(1).slice(8, 10)), now()],
    );
    expect(await evaluateNotifications(ME)).toBe(1);
    expect(pushed[0].payload).toMatchObject({ title: "Account acc-1 is running low", url: "/recurring" });
    expect(pushed[0].payload.body).toMatch(/Rent .* is due tomorrow/);
    // Next run: same bill, same day — already told.
    expect(await evaluateNotifications(ME)).toBe(0);
  });

  it("tells about a category over its budget", async () => {
    await account("acc-1", 5000);
    await exec(`INSERT INTO categories (id, user_id, name, created_at) VALUES ('c-food', ?, 'Groceries', ?)`, [ME, now()]);
    await exec(
      `INSERT INTO budgets (id, user_id, category_id, amount, period, is_active, status, source, created_at) VALUES ('b', ?, 'c-food', 100, 'monthly', 1, 'active', 'manual', ?)`,
      [ME, now()],
    );
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, created_at) VALUES ('t1', ?, 'acc-1', ?, 'AH', -150, 'expense', 'c-food', ?)`,
      [ME, iso(0), now()],
    );
    await evaluateNotifications(ME);
    expect(pushed.map((p) => p.payload.title)).toContain("Groceries is over budget");
  });

  it("spots a new subscription", async () => {
    await account("acc-1", 5000);
    for (const [i, offset] of [-61, -31, -1].entries()) {
      await exec(
        `INSERT INTO transactions (id, user_id, account_id, date, name, description, amount, type, created_at) VALUES (?, ?, 'acc-1', ?, 'NETFLIX.COM', 'Netflix', -13.99, 'expense', ?)`,
        [`n${i}`, ME, iso(offset), now()],
      );
    }
    await evaluateNotifications(ME);
    expect(pushed.map((p) => p.payload.title)).toContain("New subscription: NETFLIX.COM");
  });

  it("doesn't look at data for a user nobody can reach", async () => {
    await exec(`DELETE FROM push_subscriptions WHERE user_id = ?`, [ME]);
    await account("acc-1", 0);
    await exec(
      `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, day_of_month, start_date, is_active, match_field, created_at)
       VALUES ('rent', ?, 'acc-1', 'Rent', -1200, 'expense', 'monthly', ?, '2020-01-01', 1, 'name', ?)`,
      [ME, Number(iso(1).slice(8, 10)), now()],
    );
    expect(await evaluateNotifications(ME)).toBe(0);
    expect(await rows("SELECT * FROM notifications")).toEqual([]);
  });
});
