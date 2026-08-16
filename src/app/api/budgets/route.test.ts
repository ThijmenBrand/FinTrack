import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "budgets-route-owner";
const EDITOR = "budgets-route-editor";
const VIEWER = "budgets-route-viewer";

// `actor` is mutable so each test can act as a different member. Mirrors the
// real withUser: requireAccountAccess/resolveBudgetRowAccess THROW/403 via
// plain NextResponse.json in this route, but the plan resolution path still
// needs the real try/catch shape for consistency with the other route tests.
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
  testDb = await setupTestDb("budgets-route-roles");
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
    sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
          VALUES ('plan-x', ?, 'Joint', 1, ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
          VALUES ('acc-shared', ?, 'Joint', 'joint', 'EUR', 0, 0, 'plan-x', ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-x', ?, 'Groceries', ?)`,
    args: [OWNER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('am-editor', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?),
                 ('am-viewer', 'acc-shared', ?, 'viewer@test.dev', 'viewer', ?, ?)`,
    args: [EDITOR, now, now, VIEWER, now, now],
  });
});

const postAllocation = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/budgets", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const putAllocation = (body: unknown) =>
  import("./route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/budgets", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

describe("POST /api/budgets — shared plan role", () => {
  it("an editor on the plan's account can create an allocation; the row keeps the OWNER's userId", async () => {
    actor = EDITOR;
    const res = await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const row = (
      await testDb.client.execute({
        sql: `SELECT user_id FROM budgets WHERE id = ?`,
        args: [id],
      })
    ).rows[0];
    expect(row.user_id).toBe(OWNER);
  });

  it("a viewer-role member is blocked (403)", async () => {
    actor = VIEWER;
    const res = await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" });
    expect(res.status).toBe(403);
  });

  it("an unrelated user gets 404 for a plan not shared with them", async () => {
    actor = "budgets-route-stranger";
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [actor, actor, "stranger@test.dev", Date.now(), Date.now()],
    });
    const res = await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" });
    expect(res.status).toBe(404);
  });

  it("the owner can still create/update allocations as before", async () => {
    actor = OWNER;
    const res = await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" });
    expect(res.status).toBe(201);
  });
});

describe("PUT /api/budgets — shared plan role (editing an existing allocation by row id)", () => {
  it("an editor can edit an allocation their editor membership reaches, staying in the OWNER's space", async () => {
    actor = OWNER;
    const created = await (
      await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" })
    ).json();

    actor = EDITOR;
    const res = await putAllocation({ id: created.id, amount: 150 });
    expect(res.status).toBe(200);
    const row = (
      await testDb.client.execute({
        sql: `SELECT user_id, amount FROM budgets WHERE id = ?`,
        args: [created.id],
      })
    ).rows[0];
    expect(row.user_id).toBe(OWNER);
    expect(row.amount).toBe(150);
  });

  it("a viewer-role member is blocked from editing (403)", async () => {
    actor = OWNER;
    const created = await (
      await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" })
    ).json();

    actor = VIEWER;
    const res = await putAllocation({ id: created.id, amount: 150 });
    expect(res.status).toBe(403);
  });
});
