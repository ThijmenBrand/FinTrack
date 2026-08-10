import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "plans-route-user";

// The route only needs the caller's id; everything else is real DB work.
vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("budget-plans-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, USER, "plans-route@test.dev", Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('r-check', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [USER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('r-cat', ?, 'Groceries', ?)`,
    args: [USER, now],
  });
  // A pre-plan allocation: what a user created after 0009 (so no Main plan was
  // ever backfilled for them) ends up with.
  await testDb.client.execute({
    sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES ('r-budget', ?, NULL, 'r-cat', 250, 'monthly', 1, 'active', 'manual', ?)`,
    args: [USER, now],
  });
});

const budgetPlanIds = async () =>
  (await testDb.client.execute("SELECT budget_id FROM budgets")).rows.map(
    (r) => r.budget_id as string | null,
  );

describe("POST /api/budget-plans", () => {
  it("adopts pre-plan allocations into the user's first plan", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/budget-plans", {
        method: "POST",
        body: JSON.stringify({ name: "Main", accountIds: ["r-check"] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await budgetPlanIds()).toEqual([id]);
  });

  it("refuses to create a plan when the user has no budgetable account", async () => {
    await testDb.client.execute("DELETE FROM accounts");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/budget-plans", {
        method: "POST",
        body: JSON.stringify({ name: "Main" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
  });

  it("leaves allocations alone when a plan already exists", async () => {
    const { POST } = await import("./route");
    const mk = (name: string) =>
      POST(
        new Request("http://x/api/budget-plans", {
          method: "POST",
          body: JSON.stringify({ name }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
    const first = await (await mk("Main")).json();
    await mk("Joint");
    // Still attached to the first plan, not moved by the second create.
    expect(await budgetPlanIds()).toEqual([first.id]);
  });
});
