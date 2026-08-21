import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "commit-owner";

// Same shape as the split route test: the route only needs the caller's id,
// everything else is real DB work. requireAccountAccess THROWS a Response for
// 403/404, which the real withUser catches — so this mock must too.
vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(OWNER);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("upload-commit-route");
  // import_batches isn't part of the shared test schema; the commit route
  // records one per import, so give it somewhere to land.
  await testDb.client.execute(
    `CREATE TABLE IF NOT EXISTS import_batches (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL,
       account_id TEXT NOT NULL,
       file_name TEXT NOT NULL,
       transaction_count INTEGER NOT NULL,
       imported_at TEXT NOT NULL
     )`,
  );
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [OWNER, OWNER, `${OWNER}@test.dev`, Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-1', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at)
          VALUES ('cat-a', ?, 'Aflossing', ?), ('cat-b', ?, 'Rente', ?)`,
    args: [OWNER, now, OWNER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-other', 'someone-else', 'Theirs', ?)`,
    args: [now],
  });
});

const row = (overrides: Record<string, unknown> = {}) => ({
  tempId: "t1",
  date: "2026-08-09",
  name: "ABN AMRO",
  description: "Hypotheek",
  amount: -1000,
  balance: 500,
  type: "expense",
  categoryId: null,
  ...overrides,
});

const commit = async (transactions: unknown[]) => {
  const { POST } = await import("./route");
  const request = new Request("http://x/api/transactions/upload/commit", {
    method: "POST",
    body: JSON.stringify({
      accountId: "acc-1",
      fileName: "import.csv",
      transactions,
      newRules: [],
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return POST(request as any);
};

/** Tenant-scoped read of everything that landed in the account. */
const storedRows = async () =>
  (
    await testDb.client.execute({
      sql: `SELECT * FROM transactions WHERE user_id = ? ORDER BY rowid`,
      args: [OWNER],
    })
  ).rows;

describe("POST /api/transactions/upload/commit — split rows", () => {
  it("inserts the row as a split parent with its parts as children", async () => {
    const res = await commit([
      row({
        splits: [
          { amount: -300, categoryId: "cat-a" },
          { amount: -700, categoryId: "cat-b" },
        ],
        splitRuleId: "rule-1",
      }),
    ]);
    expect(res.status).toBe(200);

    const rows = await storedRows();
    expect(rows).toHaveLength(3);
    const [parent, ...children] = rows;

    expect(parent.is_split_parent).toBe(1);
    expect(parent.category_id).toBeNull();
    expect(parent.category_source).toBeNull();
    expect(parent.amount).toBe(-1000);
    expect(parent.balance).toBe(500);
    expect(parent.parent_transaction_id).toBeNull();

    expect(children.map((c) => c.amount)).toEqual([-300, -700]);
    expect(children.map((c) => c.category_id)).toEqual(["cat-a", "cat-b"]);
    for (const child of children) {
      expect(child.parent_transaction_id).toBe(parent.id);
      // Children inherit the bank row's identity but never its balance.
      expect(child.balance).toBeNull();
      expect(child.date).toBe(parent.date);
      expect(child.name).toBe(parent.name);
      expect(child.description).toBe(parent.description);
      expect(child.account_id).toBe("acc-1");
      expect(child.import_batch_id).toBe(parent.import_batch_id);
      expect(child.type).toBe("expense");
      expect(child.is_split_parent).toBe(0);
      // Untouched rule proposal → the children count as rule-categorized.
      expect(child.category_source).toBe("rule");
    }
  });

  it("marks children manual when the client dropped the rule id", async () => {
    await commit([
      row({
        splits: [
          { amount: -300, categoryId: "cat-a" },
          { amount: -700, categoryId: null },
        ],
      }),
    ]);
    const rows = await storedRows();
    expect(rows.map((r) => r.category_source)).toEqual([null, "manual", null]);
  });

  it.each([
    ["fewer than two parts", [{ amount: -1000, categoryId: "cat-a" }]],
    [
      "parts that do not sum to the row amount",
      [
        { amount: -300, categoryId: "cat-a" },
        { amount: -600, categoryId: "cat-b" },
      ],
    ],
    [
      "a part with the wrong sign",
      [
        { amount: -1300, categoryId: "cat-a" },
        { amount: 300, categoryId: "cat-b" },
      ],
    ],
    [
      "a zero part",
      [
        { amount: -1000, categoryId: "cat-a" },
        { amount: 0, categoryId: "cat-b" },
      ],
    ],
    [
      "a category owned by someone else",
      [
        { amount: -300, categoryId: "cat-other" },
        { amount: -700, categoryId: "cat-b" },
      ],
    ],
    [
      "twenty-one parts",
      Array.from({ length: 21 }, (_, i) => ({
        amount: i === 20 ? -1000 + 20 : -1,
        categoryId: "cat-a",
      })),
    ],
  ])("rejects %s and writes nothing", async (_label, splits) => {
    const res = await commit([row({ splits })]);
    expect(res.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  it.each([
    ["an internal transfer", { type: "internal_transfer", targetAccountId: undefined }],
    ["a reimbursement", { type: "reimbursement", amount: 1000, balance: null }],
    ["a row parked in a pot", { groupId: "pot-1" }],
  ])("refuses to split %s", async (_label, overrides) => {
    const res = await commit([
      row({
        ...overrides,
        splits: [
          { amount: -300, categoryId: "cat-a" },
          { amount: -700, categoryId: "cat-b" },
        ],
      }),
    ]);
    expect(res.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  it("leaves plain rows untouched and still imports them alongside split rows", async () => {
    const res = await commit([
      row({ tempId: "t1", categoryId: "cat-a", balance: 500 }),
      row({
        tempId: "t2",
        description: "Hypotheek 2",
        balance: 400,
        splits: [
          { amount: -400, categoryId: "cat-a" },
          { amount: -600, categoryId: "cat-b" },
        ],
      }),
    ]);
    expect(res.status).toBe(200);
    // 2 bank rows imported, the second expanded into 2 children.
    expect(await res.json()).toMatchObject({ imported: 2 });

    const rows = await storedRows();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.is_split_parent === 1)).toHaveLength(1);
    expect(rows.filter((r) => r.parent_transaction_id !== null)).toHaveLength(2);
    // Parents are inserted before the children that reference them.
    const parentIndex = rows.findIndex((r) => r.is_split_parent === 1);
    const firstChildIndex = rows.findIndex((r) => r.parent_transaction_id !== null);
    expect(parentIndex).toBeLessThan(firstChildIndex);
  });
});
