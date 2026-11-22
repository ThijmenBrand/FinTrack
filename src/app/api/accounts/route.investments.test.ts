/**
 * Investment accounts through the accounts API.
 *
 * The thing under test is a single rule: an investment account's balance is
 * the valuation someone typed in, never the sum of its transactions. It does
 * hold transactions — the mirror legs `detectTransfers` writes when money
 * moves in from a current account — and those legs are what "put in" is later
 * measured from. Adding them up as a balance would double-count the deposits
 * against the broker's own figure, so these tests pin that they are ignored.
 *
 * The second rule pinned here: a value never travels without the date it was
 * true on, and the pair only exists on an investment account.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "inv-user";

vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(USER);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);

beforeAll(async () => {
  testDb = await setupTestDb("accounts-investments");
});
afterAll(() => testDb.cleanup());

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
    args: [USER, USER, `${USER}@test.dev`],
  });
});

async function post(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://t/api/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
  );
  return { status: res.status, body: await res.json() };
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  const res = await PUT(
    new Request("http://t/api/accounts", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as never,
  );
  return { status: res.status, body: await res.json() };
}

async function list() {
  const { GET } = await import("./route");
  const res = await GET();
  return (await res.json()) as {
    id: string;
    type: string;
    currentBalance: number;
    currentValue: number | null;
    valuedAt: string | null;
    transactionTotal: number;
  }[];
}

const brokerage = (over: Record<string, unknown> = {}) => ({
  name: "DeGiro",
  type: "investment",
  currentValue: 32_480,
  valuedAt: TODAY,
  ...over,
});

/** A mirror leg: what a transfer into the brokerage leaves behind. */
async function deposit(accountId: string, amount: number, date = TODAY) {
  await testDb.client.execute({
    sql: `INSERT INTO transactions
            (id, user_id, account_id, date, description, amount, type, is_mirror, created_at)
          VALUES (?, ?, ?, ?, 'Transfer', ?, 'internal_transfer', 1, ?)`,
    args: [crypto.randomUUID(), USER, accountId, date, amount, NOW],
  });
}

describe("creating an investment account", () => {
  it("stores the valuation pair", async () => {
    const created = await post(brokerage());
    expect(created.status).toBe(201);
    expect(created.body.currentValue).toBe(32_480);
    expect(created.body.valuedAt).toBe(TODAY);
  });

  it("reports the valuation as the balance, not the deposits", async () => {
    const created = await post(brokerage());
    await deposit(created.body.id, 28_000);

    const [account] = await list();
    expect(account.currentBalance).toBe(32_480);
    // The deposits are still there — "put in" is measured from them later.
    expect(account.transactionTotal).toBe(28_000);
  });

  it("reads as not-yet-valued rather than as zero when no value is given", async () => {
    const created = await post(brokerage({ currentValue: null, valuedAt: null }));
    expect(created.body.currentValue).toBeNull();

    const [account] = await list();
    expect(account.currentValue).toBeNull();
    // The balance still has to be a number for every caller that sums it.
    expect(account.currentBalance).toBe(0);
  });

  it("refuses a value with no date", async () => {
    const res = await post(brokerage({ valuedAt: null }));
    expect(res.status).toBe(400);
  });

  it("refuses a date that is not a real calendar day", async () => {
    expect((await post(brokerage({ valuedAt: "2026-02-30" }))).status).toBe(400);
    expect((await post(brokerage({ valuedAt: "yesterday" }))).status).toBe(400);
  });

  it("refuses a valuation on a cash account instead of dropping it", async () => {
    const res = await post(brokerage({ type: "checking" }));
    expect(res.status).toBe(400);
  });
});

describe("a cash account", () => {
  it("still balances from its ledger", async () => {
    const created = await post({ name: "Main", type: "checking", initialBalance: 100 });
    await deposit(created.body.id, 50);

    const [account] = await list();
    expect(account.currentBalance).toBe(150);
  });
});

describe("updating an investment account", () => {
  it("replaces the value and its date together", async () => {
    const created = await post(brokerage());
    const updated = await put({
      id: created.body.id,
      currentValue: 33_100,
      valuedAt: TODAY,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.currentValue).toBe(33_100);

    const [account] = await list();
    expect(account.currentBalance).toBe(33_100);
  });

  it("clears the valuation when the value is sent as null", async () => {
    const created = await post(brokerage());
    await put({ id: created.body.id, currentValue: null, valuedAt: null });

    const [account] = await list();
    expect(account.currentValue).toBeNull();
    expect(account.valuedAt).toBeNull();
  });

  it("leaves the valuation alone on an edit that does not mention it", async () => {
    const created = await post(brokerage());
    await put({ id: created.body.id, name: "DeGiro NL" });

    const [account] = await list();
    expect(account.currentValue).toBe(32_480);
    expect(account.valuedAt).toBe(TODAY);
  });

  it("drops the valuation when the account stops being an investment one", async () => {
    const created = await post(brokerage());
    const updated = await put({ id: created.body.id, type: "savings" });
    expect(updated.status).toBe(200);

    const [account] = await list();
    expect(account.type).toBe("savings");
    expect(account.currentValue).toBeNull();
    expect(account.valuedAt).toBeNull();
    // And it balances from its ledger again, deposits included.
    expect(account.currentBalance).toBe(0);
  });

  it("keeps a value sent in the same write that makes it an investment account", async () => {
    const created = await post({ name: "Broker", type: "savings" });
    await put({
      id: created.body.id,
      type: "investment",
      currentValue: 1_000,
      valuedAt: TODAY,
    });

    const [account] = await list();
    expect(account.currentValue).toBe(1_000);
    expect(account.currentBalance).toBe(1_000);
  });
});
