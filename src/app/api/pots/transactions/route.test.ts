import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "pot-tx-user";

vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("pots-transactions-route");
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
  await testDb.client.execute({
    sql: `INSERT INTO transaction_groups (id, user_id, name, created_at) VALUES ('pot-1', ?, 'ULV', ?)`,
    args: [USER, now],
  });
});

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/pots/transactions", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

describe("POST /api/pots/transactions — split parents", () => {
  it("refuses to add a split parent to a pot — it's a pure wrapper, its children can join individually", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, created_at)
            VALUES ('tx-parent', ?, 'acc-1', '2026-08-05', 'Hypotheek', -900, 'expense', 1, ?)`,
      args: [USER, now],
    });

    const res = await post({ potId: "pot-1", transactionId: "tx-parent" });
    expect(res.status).toBe(409);

    const row = await testDb.client.execute({
      sql: `SELECT group_id FROM transactions WHERE id = 'tx-parent' AND user_id = ?`,
      args: [USER],
    });
    expect(row.rows[0].group_id).toBeNull();
  });

  it("still adds a normal transaction (including a split child) to a pot", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
            VALUES ('tx-plain', ?, 'acc-1', '2026-08-05', 'Groceries', -20, 'expense', ?)`,
      args: [USER, now],
    });

    const res = await post({ potId: "pot-1", transactionId: "tx-plain" });
    expect(res.status).toBe(200);

    const row = await testDb.client.execute({
      sql: `SELECT group_id FROM transactions WHERE id = 'tx-plain' AND user_id = ?`,
      args: [USER],
    });
    expect(row.rows[0].group_id).toBe("pot-1");
  });
});
