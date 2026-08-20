import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "tx-route-owner";
const EDITOR = "tx-route-editor";
const VIEWER = "tx-route-viewer";

// The route only needs the caller's id; everything else is real DB work.
// `actor` is mutable so each test can act as a different member. Mirrors the
// real withUser: requireAccountAccess THROWS a Response for 403/404, which
// the real wrapper catches — this mock must too, or the throw surfaces as an
// unhandled rejection instead of a normal response.
let actor = OWNER;
vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(actor);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("transactions-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  actor = OWNER;
  await testDb.reset();
  const now = new Date().toISOString();
  for (const id of [OWNER, EDITOR, VIEWER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@test.dev`, Date.now(), Date.now()],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-shared', ?, 'Joint', 'joint', 'EUR', 0, 0, ?, ?),
                 ('acc-private', ?, 'Private', 'checking', 'EUR', 0, 1, ?, ?)`,
    args: [OWNER, now, now, OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-owner', ?, 'Groceries', ?)`,
    args: [OWNER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-editor', ?, 'Fun', ?)`,
    args: [EDITOR, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('am-editor', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?),
                 ('am-viewer', 'acc-shared', ?, 'viewer@test.dev', 'viewer', ?, ?)`,
    args: [EDITOR, now, now, VIEWER, now, now],
  });
});

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/transactions", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const get = (query: string) =>
  import("./route").then(({ GET }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GET(new Request(`http://x/api/transactions?${query}`) as any),
  );

describe("GET /api/transactions — category filter", () => {
  // A pot's category lives on the pot, not on its members: budgets and insights
  // book the pot's whole net under it, so filtering this endpoint on that
  // category must find the pot too or the two screens disagree.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transaction_groups (id, user_id, name, category_id, created_at)
            VALUES ('pot-1', ?, 'ULV', 'cat-owner', ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, group_id, created_at)
            VALUES ('tx-direct', ?, 'acc-private', '2026-08-09', 'Bar', -20, 'expense', 'cat-owner', NULL, ?),
                   ('tx-potted', ?, 'acc-private', '2026-08-10', 'Pot member', -30, 'expense', NULL, 'pot-1', ?),
                   ('tx-other', ?, 'acc-private', '2026-08-11', 'Unrelated', -99, 'expense', NULL, NULL, ?)`,
      args: [OWNER, now, OWNER, now, OWNER, now],
    });
  });

  it("counts a pot's net under the pot's own category, even when its members are uncategorised", async () => {
    const body = await (await get("categoryId=cat-owner")).json();
    expect(body.totals.expense).toBeCloseTo(-50, 2); // direct 20 + pot net 30
    expect(body.potTotals).toHaveLength(1);
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual([
      "tx-direct",
      "tx-potted",
    ]);
  });

  it("still leaves rows outside the category alone", async () => {
    const body = await (await get("categoryId=cat-editor")).json();
    expect(body.pagination.total).toBe(0);
    expect(body.totals.expense).toBeCloseTo(0, 2);
  });
});

describe("POST /api/transactions", () => {
  it("an editor creates a transaction on a shared account: row keeps the OWNER's userId, attributes createdBy to the editor, and validates the category in the OWNER's space", async () => {
    actor = EDITOR;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Groceries run",
      amount: -42,
      type: "expense",
      categoryId: "cat-owner",
    });
    expect(res.status).toBe(201);
    const created = await res.json();

    const row = (
      await testDb.client.execute({
        sql: `SELECT user_id, created_by, category_id FROM transactions WHERE id = ?`,
        args: [created.id],
      })
    ).rows[0];
    expect(row.user_id).toBe(OWNER);
    expect(row.created_by).toBe(EDITOR);
    expect(row.category_id).toBe("cat-owner");
  });

  it("rejects a category from the editor's own space — only the account owner's categories are valid there", async () => {
    actor = EDITOR;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Groceries run",
      amount: -42,
      type: "expense",
      categoryId: "cat-editor",
    });
    expect(res.status).toBe(404);
  });

  it("a viewer cannot create a transaction (403)", async () => {
    actor = VIEWER;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Nope",
      amount: -10,
      type: "expense",
    });
    expect(res.status).toBe(403);
  });

  it("a member cannot write to an unshared account (404, existence hidden)", async () => {
    actor = EDITOR;
    const res = await post({
      accountId: "acc-private",
      date: "2026-08-01",
      description: "Nope",
      amount: -10,
      type: "expense",
    });
    expect(res.status).toBe(404);
  });

  it("the owner posting to their own account works as before", async () => {
    actor = OWNER;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Rent",
      amount: -900,
      type: "expense",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    const row = (
      await testDb.client.execute({
        sql: `SELECT user_id, created_by FROM transactions WHERE id = ?`,
        args: [created.id],
      })
    ).rows[0];
    expect(row.user_id).toBe(OWNER);
    expect(row.created_by).toBe(OWNER);
  });
});

const categorize = (body: unknown) =>
  import("./categorize/route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/transactions/categorize", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

/** An uncategorized owner expense on the account that was never shared. */
async function seedPrivateExpense() {
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES ('tx-private', ?, 'acc-private', '2026-08-01', 'Secret groceries', -20, 'expense', ?)`,
    args: [OWNER, new Date().toISOString()],
  });
}

describe("PUT /api/transactions/categorize — rule creation is owner-only", () => {
  it("a viewer cannot plant a rule in the owner's space or touch the owner's unshared account", async () => {
    await seedPrivateExpense();
    actor = VIEWER;

    const res = await categorize({
      transactionIds: ["tx-private"],
      categoryId: "cat-owner",
      createRule: true,
      rulePattern: "groceries",
      ruleMatchType: "contains",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ruleId: null, appliedCount: 0 });

    const rules = await testDb.client.execute({
      sql: `SELECT id FROM category_rules WHERE user_id = ?`,
      args: [OWNER],
    });
    expect(rules.rows).toHaveLength(0);

    const tx = await testDb.client.execute({
      sql: `SELECT category_id FROM transactions WHERE id = 'tx-private' AND user_id = ?`,
      args: [OWNER],
    });
    expect(tx.rows[0].category_id).toBeNull();
  });

  it("an editor on a shared account still cannot — a rule reaches accounts outside the share", async () => {
    await seedPrivateExpense();
    actor = EDITOR;

    await categorize({
      transactionIds: ["tx-private"],
      categoryId: "cat-owner",
      createRule: true,
      rulePattern: "groceries",
      ruleMatchType: "contains",
    });

    const rules = await testDb.client.execute({
      sql: `SELECT id FROM category_rules WHERE user_id = ?`,
      args: [OWNER],
    });
    expect(rules.rows).toHaveLength(0);
  });

  it("the owner still creates the rule and it applies to their own rows", async () => {
    await seedPrivateExpense();
    actor = OWNER;

    const res = await categorize({
      transactionIds: ["tx-private"],
      categoryId: "cat-owner",
      createRule: true,
      rulePattern: "groceries",
      ruleMatchType: "contains",
    });

    const body = await res.json();
    expect(body.ruleId).not.toBeNull();

    const rules = await testDb.client.execute({
      sql: `SELECT category_id FROM category_rules WHERE user_id = ?`,
      args: [OWNER],
    });
    expect(rules.rows).toHaveLength(1);
    expect(rules.rows[0].category_id).toBe("cat-owner");
  });
});
