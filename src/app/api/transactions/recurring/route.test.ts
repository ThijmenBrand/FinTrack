/**
 * "Link it once and it's always that one": the first hand-made link teaches
 * the plan a rule, and the plan's detail page then shows the whole history.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const ME = "rec-link-me";
const VIEWER = "rec-link-viewer";

let actor = ME;
vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) =>
    handler(actor).catch((e: unknown) => {
      if (e instanceof Response) return e;
      throw e;
    }),
}));
vi.mock("@/lib/audit", () => ({ logDataEvent: () => {} }));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("recurring-link-route");
});
afterAll(async () => {
  await testDb.cleanup();
});

let seq = 0;
async function tx(name: string, amount: number, accountId = "acc", date = "2026-05-01") {
  const id = `tx-${++seq}`;
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, name, description, amount, type, created_at)
          VALUES (?, ?, ?, ?, ?, 'Incasso ref', ?, ?, ?)`,
    args: [id, ME, accountId, date, name, amount, amount < 0 ? "expense" : "income", new Date().toISOString()],
  });
  return id;
}

const planRule = async () =>
  (
    await testDb.client.execute(
      "SELECT match_pattern AS p, match_field AS f FROM recurring_transactions WHERE id = 'hbo'",
    )
  ).rows[0];

const linkOf = async (id: string) =>
  (
    await testDb.client.execute({
      sql: "SELECT recurring_transaction_id AS r FROM transactions WHERE id = ?",
      args: [id],
    })
  ).rows[0].r;

const link = (transactionId: string, recurringTransactionId: string | null) =>
  import("./route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/transactions/recurring", {
        method: "PUT",
        body: JSON.stringify({ transactionId, recurringTransactionId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const detail = (id: string) =>
  import("../../recurring/[id]/route").then(({ GET }) =>
    GET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Request(`http://x/api/recurring/${id}`) as any,
      { params: Promise.resolve({ id }) },
    ),
  );

beforeEach(async () => {
  actor = ME;
  await testDb.reset();
  const now = new Date().toISOString();
  for (const id of [ME, VIEWER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@test.dev`, Date.now(), Date.now()],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, created_at, updated_at) VALUES
            ('acc', ?, 'Checking', 'checking', ?, ?), ('acc-2', ?, 'Savings', 'savings', ?, ?)`,
    args: [ME, now, now, ME, now, now],
  });
  // A plan named nothing like the bank text, so only a learned rule can find it.
  await testDb.client.execute({
    sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, day_of_month, start_date, created_at)
          VALUES ('hbo', ?, 'acc', 'Streaming', -4.5, 'expense', 'monthly', 1, '2026-01-01', ?)`,
    args: [ME, now],
  });
});

describe("PUT /api/transactions/recurring — learning", () => {
  it("learns the counterparty from the first link and links the rest of the history", async () => {
    const first = await tx("HBO Max", -4.5, "acc", "2026-03-01");
    const cheaper = await tx("HBO Max", -3.99, "acc", "2026-01-01");
    const pricier = await tx("HBO Max", -5.99, "acc", "2026-04-01");
    const unrelated = await tx("Spotify", -4.5);

    const res = await link(first, "hbo");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      learnedPattern: "HBO Max",
      alsoLinkedIds: expect.arrayContaining([cheaper, pricier]),
    });
    expect(await planRule()).toMatchObject({ p: "HBO Max", f: "name" });
    expect(await linkOf(cheaper)).toBe("hbo");
    expect(await linkOf(pricier)).toBe("hbo");
    expect(await linkOf(unrelated)).toBeNull();
  });

  it("keeps a rule it already has", async () => {
    await testDb.client.execute("UPDATE recurring_transactions SET match_pattern = 'HBO' WHERE id = 'hbo'");
    const odd = await tx("Something else", -4.5);
    const res = await link(odd, "hbo");
    expect(await res.json()).toMatchObject({ learnedPattern: null, alsoLinkedIds: [] });
    expect(await planRule()).toMatchObject({ p: "HBO" });
  });

  it("learns a nameless row's text — a single-column import keeps the title there", async () => {
    const nameless = async (description: string, amount: number) => {
      const id = `tx-${++seq}`;
      await testDb.client.execute({
        sql: `INSERT INTO transactions (id, user_id, account_id, date, name, description, amount, type, created_at)
              VALUES (?, ?, 'acc', '2026-05-01', NULL, ?, ?, 'expense', ?)`,
        args: [id, ME, description, amount, new Date().toISOString()],
      });
      return id;
    };
    const first = await nameless("VERmax Messtechnik GmbH", -47.79);
    const next = await nameless("VERmax Messtechnik GmbH", -52.1);

    const res = await link(first, "hbo");
    expect(await res.json()).toMatchObject({
      learnedPattern: "VERmax Messtechnik GmbH",
      alsoLinkedIds: [next],
    });
    expect(await planRule()).toMatchObject({ p: "VERmax Messtechnik GmbH", f: "name" });
  });

  it("doesn't learn from a row on another account", async () => {
    const elsewhere = await tx("HBO Max", -4.5, "acc-2");
    await link(elsewhere, "hbo");
    expect((await planRule()).p).toBeNull();
  });

  it("doesn't learn a payment processor's name", async () => {
    const paypal = await tx("PayPal Europe S.a.r.l. et Cie S.C.A", -4.5);
    await tx("PayPal Europe S.a.r.l. et Cie S.C.A", -30);
    const res = await link(paypal, "hbo");
    expect(await res.json()).toMatchObject({ learnedPattern: null, alsoLinkedIds: [] });
    expect((await planRule()).p).toBeNull();
  });

  it("an unlink stays unlinked, even when the rule is learned again", async () => {
    const first = await tx("HBO Max", -4.5);
    const second = await tx("HBO Max", -4.5);
    await link(first, "hbo");
    await link(second, null);
    expect(await linkOf(second)).toBeNull();

    // Forget the rule and teach it again: the backfill runs once more.
    await testDb.client.execute("UPDATE recurring_transactions SET match_pattern = NULL WHERE id = 'hbo'");
    await link(first, null);
    const res = await link(first, "hbo");
    expect(await res.json()).toMatchObject({ learnedPattern: "HBO Max", alsoLinkedIds: [] });
    expect(await linkOf(second)).toBeNull();
  });

  it("linking by hand forgets an earlier unlink", async () => {
    const row = await tx("HBO Max", -4.5);
    await link(row, "hbo");
    await link(row, null);
    await link(row, "hbo");
    const excluded = await testDb.client.execute({
      sql: "SELECT recurring_excluded_plan_id AS e FROM transactions WHERE id = ?",
      args: [row],
    });
    expect(excluded.rows[0].e).toBeNull();
    expect(await linkOf(row)).toBe("hbo");
  });
});

describe("POST /api/recurring/[id]/undo-learned-rule", () => {
  const undo = (pattern: string, transactionIds: string[]) =>
    import("../../recurring/[id]/undo-learned-rule/route").then(({ POST }) =>
      POST(
        new Request("http://x/api/recurring/hbo/undo-learned-rule", {
          method: "POST",
          body: JSON.stringify({ pattern, transactionIds }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
        { params: Promise.resolve({ id: "hbo" }) },
      ),
    );

  it("clears the rule and unlinks what it linked, keeping the hand-made link", async () => {
    const first = await tx("HBO Max", -4.5);
    const other = await tx("HBO Max", -5.99);
    const { learnedPattern, alsoLinkedIds } = await (await link(first, "hbo")).json();
    expect(alsoLinkedIds).toEqual([other]);

    expect((await undo(learnedPattern, alsoLinkedIds)).status).toBe(200);
    expect((await planRule()).p).toBeNull();
    expect(await linkOf(first)).toBe("hbo");
    expect(await linkOf(other)).toBeNull();
  });

  it("keeps a rule the user has changed since", async () => {
    const first = await tx("HBO Max", -4.5);
    await link(first, "hbo");
    await testDb.client.execute("UPDATE recurring_transactions SET match_pattern = 'HBO' WHERE id = 'hbo'");
    await undo("HBO Max", []);
    expect((await planRule()).p).toBe("HBO");
  });

  it("leaves rows linked to another plan alone", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, day_of_month, start_date, created_at)
            VALUES ('other', ?, 'acc', 'Other', -4.5, 'expense', 'monthly', 1, '2026-01-01', ?)`,
      args: [ME, new Date().toISOString()],
    });
    const elsewhere = await tx("HBO Max", -4.5);
    await testDb.client.execute({
      sql: "UPDATE transactions SET recurring_transaction_id = 'other' WHERE id = ?",
      args: [elsewhere],
    });
    await undo("HBO Max", [elsewhere]);
    expect(await linkOf(elsewhere)).toBe("other");
  });
});

describe("GET /api/recurring/[id]", () => {
  it("lists linked payments newest first, and look-alikes with any amount", async () => {
    await testDb.client.execute("UPDATE recurring_transactions SET description = 'HBO Max' WHERE id = 'hbo'");
    const older = await tx("HBO Max", -3.99, "acc", "2026-01-01");
    const newer = await tx("HBO Max", -4.5, "acc", "2026-02-01");
    const lookalike = await tx("HBO MAX EUROPE", -9.99, "acc", "2026-03-01");
    await testDb.client.execute({
      sql: "UPDATE transactions SET recurring_transaction_id = 'hbo' WHERE id IN (?, ?)",
      args: [older, newer],
    });

    const res = await detail("hbo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canEdit).toBe(true);
    expect(body.plan).toMatchObject({ id: "hbo", accountName: "Checking", matchPattern: null });
    expect(body.transactions.map((t: { id: string }) => t.id)).toEqual([newer, older]);
    expect(body.suggestions.map((t: { id: string }) => t.id)).toEqual([lookalike]);
    expect(body.plan).not.toHaveProperty("userId");
  });

  it("suggests rows like a payment linked before the plan could learn", async () => {
    // HBO Max shared through a friend: nothing in the bank text says HBO.
    const linkedEarlier = await tx("Inge Pebesma", -4.5, "acc", "2026-07-01");
    await testDb.client.execute({
      sql: "UPDATE transactions SET recurring_transaction_id = 'hbo' WHERE id = ?",
      args: [linkedEarlier],
    });
    const sameFriend = await tx("Inge Pebesma", -4.5, "acc", "2026-06-01");
    await tx("Someone else", -4.5, "acc", "2026-06-01");

    const body = await (await detail("hbo")).json();
    expect(body.suggestions.map((t: { id: string }) => t.id)).toEqual([sameFriend]);

    // Once it has a rule, the rule did the linking — no second guess.
    await testDb.client.execute("UPDATE recurring_transactions SET match_pattern = 'Netflix' WHERE id = 'hbo'");
    expect((await (await detail("hbo")).json()).suggestions).toEqual([]);
  });

  it("doesn't suggest a row the user unlinked from this plan", async () => {
    await testDb.client.execute("UPDATE recurring_transactions SET description = 'HBO Max' WHERE id = 'hbo'");
    const row = await tx("HBO Max", -4.5);
    await link(row, "hbo");
    await link(row, null);
    const body = await (await detail("hbo")).json();
    expect(body.suggestions).toEqual([]);
  });

  it("is a 404 for someone the plan isn't shared with", async () => {
    actor = VIEWER;
    expect((await detail("hbo")).status).toBe(404);
  });
});
