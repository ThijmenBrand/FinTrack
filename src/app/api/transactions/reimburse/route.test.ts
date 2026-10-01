import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "reimburse-user";

vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("reimburse-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, USER, `${USER}@test.dev`, Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-1', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [USER, now, now],
  });
});

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/transactions/reimburse", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

describe("POST /api/transactions/reimburse — split parents", () => {
  it("refuses when the reimbursement transaction is itself a split parent", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, created_at)
            VALUES ('tx-reimb', ?, 'acc-1', '2026-08-05', 'Refund', 50, 'income', 1, ?),
                   ('tx-expense', ?, 'acc-1', '2026-08-04', 'Dinner', -50, 'expense', 0, ?)`,
      args: [USER, now, USER, now],
    });

    const res = await post({ transactionId: "tx-reimb", expenseIds: ["tx-expense"] });
    expect(res.status).toBe(409);

    const type = await testDb.client.execute({
      sql: `SELECT type FROM transactions WHERE id = 'tx-reimb' AND user_id = ?`,
      args: [USER],
    });
    expect(type.rows[0].type).toBe("income");
  });

  it("refuses when a linked expense is a split parent", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, created_at)
            VALUES ('tx-reimb', ?, 'acc-1', '2026-08-05', 'Refund', 50, 'income', 0, ?),
                   ('tx-expense', ?, 'acc-1', '2026-08-04', 'Dinner', -50, 'expense', 1, ?)`,
      args: [USER, now, USER, now],
    });

    const res = await post({ transactionId: "tx-reimb", expenseIds: ["tx-expense"] });
    expect(res.status).toBe(409);
  });

  it("still links a normal reimbursement to a normal expense", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
            VALUES ('tx-reimb', ?, 'acc-1', '2026-08-05', 'Refund', 50, 'income', ?),
                   ('tx-expense', ?, 'acc-1', '2026-08-04', 'Dinner', -50, 'expense', ?)`,
      args: [USER, now, USER, now],
    });

    const res = await post({ transactionId: "tx-reimb", expenseIds: ["tx-expense"] });
    expect(res.status).toBe(200);
  });
});

const OTHER = "reimburse-other-user";

const del = (query: string) =>
  import("./route").then(({ DELETE }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DELETE(new Request(`http://x/api/transactions/reimburse?${query}`, { method: "DELETE" }) as any),
  );

const postRaw = (raw: string) =>
  import("./route").then(({ POST }) =>
    POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Request("http://x/api/transactions/reimburse", { method: "POST", body: raw }) as any,
    ),
  );

async function insertTx(id: string, amount: number, type: string, userId = USER) {
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES (?, ?, 'acc-1', '2026-08-05', ?, ?, ?, ?)`,
    args: [id, userId, id, amount, type, new Date().toISOString()],
  });
}

async function linksOf(reimbursementId: string): Promise<string[]> {
  const rows = await testDb.client.execute({
    sql: `SELECT expense_id FROM reimbursement_links WHERE reimbursement_id = ? ORDER BY expense_id`,
    args: [reimbursementId],
  });
  return rows.rows.map((r) => r.expense_id as string);
}

async function typeOf(id: string): Promise<string> {
  const rows = await testDb.client.execute({ sql: `SELECT type FROM transactions WHERE id = ?`, args: [id] });
  return rows.rows[0].type as string;
}

describe("POST /api/transactions/reimburse — linking", () => {
  beforeEach(async () => {
    await insertTx("tx-refund", 60, "income");
    await insertTx("tx-dinner", -40, "expense");
    await insertTx("tx-taxi", -20, "expense");
  });

  it("links one income to several expenses and marks it a reimbursement", async () => {
    const res = await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-taxi"] });
    expect(res.status).toBe(200);
    expect(await linksOf("tx-refund")).toEqual(["tx-dinner", "tx-taxi"]);
    expect(await typeOf("tx-refund")).toBe("reimbursement");
  });

  it("collapses an id named twice into one link", async () => {
    const res = await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-dinner"] });
    expect(res.status).toBe(200);
    expect(await linksOf("tx-refund")).toEqual(["tx-dinner"]);
  });

  it("linking a pair a second time adds no duplicate row, only the new expense", async () => {
    await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner"] });
    const res = await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-taxi"] });
    expect(res.status).toBe(200);
    expect(await linksOf("tx-refund")).toEqual(["tx-dinner", "tx-taxi"]);
  });

  it("no longer accepts the legacy single `expenseId` field", async () => {
    const res = await post({ transactionId: "tx-refund", expenseId: "tx-dinner" });
    expect(res.status).toBe(400);
    expect(await linksOf("tx-refund")).toEqual([]);
    expect(await typeOf("tx-refund")).toBe("income");
  });

  it.each([
    ["no body fields", {}],
    ["a missing transactionId", { expenseIds: ["tx-dinner"] }],
    ["an empty transactionId", { transactionId: "", expenseIds: ["tx-dinner"] }],
    ["a non-string transactionId", { transactionId: 42, expenseIds: ["tx-dinner"] }],
    ["an empty expenseIds array", { transactionId: "tx-refund", expenseIds: [] }],
    ["expenseIds as a bare string", { transactionId: "tx-refund", expenseIds: "tx-dinner" }],
    ["a non-string entry in expenseIds", { transactionId: "tx-refund", expenseIds: ["tx-dinner", 7] }],
    ["an empty-string entry in expenseIds", { transactionId: "tx-refund", expenseIds: ["tx-dinner", ""] }],
    ["null expenseIds", { transactionId: "tx-refund", expenseIds: null }],
  ])("rejects %s with 400 and writes nothing", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await linksOf("tx-refund")).toEqual([]);
    expect(await typeOf("tx-refund")).toBe("income");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["an empty body", ""],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
  ])("rejects %s with 400 rather than a server error", async (_label, raw) => {
    const res = await postRaw(raw);
    expect(res.status).toBe(400);
  });

  it("404s when the reimbursement transaction does not exist", async () => {
    const res = await post({ transactionId: "tx-missing", expenseIds: ["tx-dinner"] });
    expect(res.status).toBe(404);
  });

  it("404s on another user's reimbursement transaction, leaving it untouched", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [OTHER, OTHER, `${OTHER}@test.dev`, Date.now(), Date.now()],
    });
    await insertTx("tx-foreign-refund", 60, "income", OTHER);
    const res = await post({ transactionId: "tx-foreign-refund", expenseIds: ["tx-dinner"] });
    expect(res.status).toBe(404);
    expect(await typeOf("tx-foreign-refund")).toBe("income");
  });

  it("404s when any expense is missing or someone else's, linking none of them", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [OTHER, OTHER, `${OTHER}@test.dev`, Date.now(), Date.now()],
    });
    await insertTx("tx-foreign-expense", -10, "expense", OTHER);

    expect((await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-missing"] })).status).toBe(404);
    expect(
      (await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-foreign-expense"] })).status,
    ).toBe(404);
    expect(await linksOf("tx-refund")).toEqual([]);
    expect(await typeOf("tx-refund")).toBe("income");
  });

  it("refuses a reimbursement that is not money in (zero or negative)", async () => {
    await insertTx("tx-zero", 0, "income");
    expect((await post({ transactionId: "tx-zero", expenseIds: ["tx-dinner"] })).status).toBe(400);
    expect((await post({ transactionId: "tx-taxi", expenseIds: ["tx-dinner"] })).status).toBe(400);
    expect(await typeOf("tx-taxi")).toBe("expense");
  });

  it("refuses to link an expense that is not money out, linking nothing", async () => {
    await insertTx("tx-salary", 1000, "income");
    const res = await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-salary"] });
    expect(res.status).toBe(400);
    expect(await linksOf("tx-refund")).toEqual([]);
  });
});

describe("DELETE /api/transactions/reimburse", () => {
  beforeEach(async () => {
    await insertTx("tx-refund", 60, "income");
    await insertTx("tx-dinner", -40, "expense");
    await insertTx("tx-taxi", -20, "expense");
    await post({ transactionId: "tx-refund", expenseIds: ["tx-dinner", "tx-taxi"] });
  });

  it("unlinks everything and turns the transaction back into income", async () => {
    const res = await del("id=tx-refund");
    expect(res.status).toBe(200);
    expect(await linksOf("tx-refund")).toEqual([]);
    expect(await typeOf("tx-refund")).toBe("income");
  });

  it("unlinks a single expense and stays a reimbursement while links remain", async () => {
    const res = await del("id=tx-refund&expenseId=tx-dinner");
    expect(res.status).toBe(200);
    expect(await linksOf("tx-refund")).toEqual(["tx-taxi"]);
    expect(await typeOf("tx-refund")).toBe("reimbursement");
  });

  it("reverts to income once the last single link is removed", async () => {
    await del("id=tx-refund&expenseId=tx-dinner");
    await del("id=tx-refund&expenseId=tx-taxi");
    expect(await linksOf("tx-refund")).toEqual([]);
    expect(await typeOf("tx-refund")).toBe("income");
  });

  it("400s without an id", async () => {
    expect((await del("")).status).toBe(400);
    expect(await linksOf("tx-refund")).toEqual(["tx-dinner", "tx-taxi"]);
  });

  it("404s for an unknown transaction", async () => {
    expect((await del("id=tx-missing")).status).toBe(404);
  });

  it("400s for a transaction that is not a reimbursement, leaving its type alone", async () => {
    expect((await del("id=tx-dinner")).status).toBe(400);
    expect(await typeOf("tx-dinner")).toBe("expense");
  });

  it("404s on another user's reimbursement", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [OTHER, OTHER, `${OTHER}@test.dev`, Date.now(), Date.now()],
    });
    await insertTx("tx-foreign", 60, "reimbursement", OTHER);
    expect((await del("id=tx-foreign")).status).toBe(404);
    expect(await typeOf("tx-foreign")).toBe("reimbursement");
  });
});
