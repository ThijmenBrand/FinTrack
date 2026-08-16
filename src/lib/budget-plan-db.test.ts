import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, type TestDb } from "./test-db";

let testDb: TestDb;
const USER = "plan-user";
const OTHER = "plan-other";

beforeAll(async () => {
  testDb = await setupTestDb("budget-plan");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  for (const [id, email] of [
    [USER, "plan@test.dev"],
    [OTHER, "other@test.dev"],
  ]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, email, Date.now(), Date.now()],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
          VALUES ('plan-main', ?, 'Main', 1, ?, ?), ('plan-joint', ?, 'Joint', 0, ?, ?)`,
    args: [USER, now, now, USER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
          VALUES ('acc-a', ?, 'A', 'checking', 'EUR', 0, 0, 'plan-main', ?, ?),
                 ('acc-b', ?, 'B', 'joint', 'EUR', 0, 1, 'plan-joint', ?, ?),
                 ('acc-c', ?, 'C', 'savings', 'EUR', 0, 2, NULL, ?, ?)`,
    args: [USER, now, now, USER, now, now, USER, now, now],
  });
});

describe("resolveBudgetPlan", () => {
  it("resolves the main plan when no id is given", async () => {
    const { resolveBudgetPlan } = await import("./budget-plan");
    const plan = await resolveBudgetPlan(USER, null);
    expect(plan).toMatchObject({ id: "plan-main", name: "Main", isMain: true });
    expect(plan!.accountIds).toEqual(["acc-a"]);
  });

  it("resolves a plan by id with its own accounts", async () => {
    const { resolveBudgetPlan } = await import("./budget-plan");
    const plan = await resolveBudgetPlan(USER, "plan-joint");
    expect(plan).toMatchObject({ id: "plan-joint", isMain: false });
    expect(plan!.accountIds).toEqual(["acc-b"]);
  });

  it("does not resolve another user's plan", async () => {
    const { resolveBudgetPlan } = await import("./budget-plan");
    expect(await resolveBudgetPlan(OTHER, "plan-main")).toBeNull();
    expect(await resolveBudgetPlan(OTHER, null)).toBeNull();
  });
});

describe("resolveBudgetPlan — foreign plan role", () => {
  async function membership(role: "editor" | "viewer", accountId = "acc-b") {
    await testDb.client.execute({
      sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
            VALUES (?, ?, ?, 'other@test.dev', ?, ?, ?)`,
      args: [crypto.randomUUID(), accountId, OTHER, role, new Date().toISOString(), new Date().toISOString()],
    });
  }

  it("resolves 'editor' when the member has write access to any plan account", async () => {
    const { resolveBudgetPlan } = await import("./budget-plan");
    await membership("editor");
    const plan = await resolveBudgetPlan(OTHER, "plan-joint");
    expect(plan).toMatchObject({ id: "plan-joint", ownerId: USER, role: "editor" });
  });

  it("resolves 'viewer' when the member only has read access", async () => {
    const { resolveBudgetPlan } = await import("./budget-plan");
    await membership("viewer");
    const plan = await resolveBudgetPlan(OTHER, "plan-joint");
    expect(plan).toMatchObject({ id: "plan-joint", ownerId: USER, role: "viewer" });
  });

  it("takes the HIGHEST role across multiple accounts on the same plan", async () => {
    // Add a second account to plan-joint, share it as viewer while acc-b is editor.
    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
            VALUES ('acc-d', ?, 'D', 'joint', 'EUR', 0, 3, 'plan-joint', ?, ?)`,
      args: [USER, new Date().toISOString(), new Date().toISOString()],
    });
    await membership("viewer", "acc-d");
    await membership("editor", "acc-b");
    const { resolveBudgetPlan } = await import("./budget-plan");
    const plan = await resolveBudgetPlan(OTHER, "plan-joint");
    expect(plan?.role).toBe("editor");
  });
});

describe("accountScopeFilter", () => {
  it("matches nothing for an empty scope instead of everything", async () => {
    const { accountScopeFilter } = await import("./budget-plan");
    const { db } = await import("@/db");
    const { transactions } = await import("@/db/schema");
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_manual, created_at)
            VALUES ('t1', ?, 'acc-a', '2026-08-01', 'x', -10, 'expense', 0, ?)`,
      args: [USER, now],
    });

    const all = await db.select().from(transactions).where(accountScopeFilter(undefined));
    expect(all).toHaveLength(1);
    const scoped = await db
      .select()
      .from(transactions)
      .where(accountScopeFilter(["acc-a"]));
    expect(scoped).toHaveLength(1);
    const none = await db.select().from(transactions).where(accountScopeFilter([]));
    expect(none).toHaveLength(0);
  });
});

describe("main-budget uniqueness", () => {
  it("rejects a second main plan for the same user, allows one per user", async () => {
    const now = new Date().toISOString();
    await expect(
      testDb.client.execute({
        sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
              VALUES ('plan-dup', ?, 'Dup', 1, ?, ?)`,
        args: [USER, now, now],
      }),
    ).rejects.toThrow(/UNIQUE/);
    // A different user's main is fine.
    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
            VALUES ('plan-other-main', ?, 'Main', 1, ?, ?)`,
      args: [OTHER, now, now],
    });
    // And any number of non-main plans.
    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
            VALUES ('plan-extra', ?, 'Extra', 0, ?, ?)`,
      args: [USER, now, now],
    });
  });
});
