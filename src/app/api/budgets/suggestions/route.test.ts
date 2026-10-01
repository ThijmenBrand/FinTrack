import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "suggestions-owner";
const EDITOR = "suggestions-editor";
const VIEWER = "suggestions-viewer";
const STRANGER = "suggestions-stranger";

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
  testDb = await setupTestDb("budget-suggestions-roles");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  actor = OWNER;
  await testDb.reset();
  const now = new Date().toISOString();
  for (const id of [OWNER, EDITOR, VIEWER, STRANGER]) {
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
    sql: `INSERT INTO categories (id, user_id, name, created_at)
          VALUES ('cat-a', ?, 'Groceries', ?), ('cat-b', ?, 'Fuel', ?)`,
    args: [OWNER, now, OWNER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('am-editor', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?),
                 ('am-viewer', 'acc-shared', ?, 'viewer@test.dev', 'viewer', ?, ?)`,
    args: [EDITOR, now, now, VIEWER, now, now],
  });
  // Suggestions live in the plan owner's space, whoever generated them.
  await testDb.client.execute({
    sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES ('sug-a', ?, 'plan-x', 'cat-a', 300, 'monthly', 0, 'suggested', 'auto', ?),
                 ('sug-b', ?, 'plan-x', 'cat-b', 80, 'monthly', 0, 'suggested', 'auto', ?)`,
    args: [OWNER, now, OWNER, now],
  });
});

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/budgets/suggestions", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const statusOf = async (id: string) => {
  const res = await testDb.client.execute({
    sql: `SELECT status FROM budgets WHERE id = ?`,
    args: [id],
  });
  return (res.rows[0]?.status as string | undefined) ?? null;
};

describe("POST /api/budgets/suggestions on a shared plan", () => {
  it("lets an editor reject the owner's suggestions", async () => {
    actor = EDITOR;
    const res = await post({ action: "reject", ids: ["sug-a", "sug-b"] });
    expect(await res.json()).toMatchObject({ count: 2 });
    expect(await statusOf("sug-a")).toBeNull();
    expect(await statusOf("sug-b")).toBeNull();
  });

  it("lets an editor accept into the owner's space", async () => {
    actor = EDITOR;
    const res = await post({ action: "accept", items: [{ id: "sug-a", amount: 320 }] });
    expect(await res.json()).toMatchObject({ count: 1 });
    const row = await testDb.client.execute(`SELECT user_id, amount, status FROM budgets WHERE id = 'sug-a'`);
    expect(row.rows[0]).toMatchObject({ user_id: OWNER, amount: 320, status: "active" });
  });

  it("ignores a viewer's reject and accept", async () => {
    actor = VIEWER;
    expect(await (await post({ action: "reject", ids: ["sug-a"] })).json()).toMatchObject({ count: 0 });
    expect(await (await post({ action: "accept", items: [{ id: "sug-b" }] })).json()).toMatchObject({ count: 0 });
    expect(await statusOf("sug-a")).toBe("suggested");
    expect(await statusOf("sug-b")).toBe("suggested");
  });

  it("ignores a stranger's reject", async () => {
    actor = STRANGER;
    expect(await (await post({ action: "reject", ids: ["sug-a"] })).json()).toMatchObject({ count: 0 });
    expect(await statusOf("sug-a")).toBe("suggested");
  });
});
