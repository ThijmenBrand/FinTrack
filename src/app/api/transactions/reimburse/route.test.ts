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
