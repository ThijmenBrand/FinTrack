import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "categories-route-user";

let actor = USER;
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
  testDb = await setupTestDb("categories-route-delete");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  actor = USER;
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, "User", "user@test.dev", Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-1', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [USER, now, now],
  });
});

const deleteCategories = (ids: string[]) =>
  import("./route").then(({ DELETE }) => {
    const params = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    return DELETE(
      new Request(`http://x/api/categories?${params}`, {
        method: "DELETE",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  });

describe("DELETE /api/categories", () => {
  it("deletes categories with linked transactions, recurring transactions, and pots without foreign key errors", async () => {
    const now = new Date().toISOString();

    // 1. Insert categories
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES
            ('cat-tx', ?, 'Groceries', ?),
            ('cat-rec', ?, 'Rent', ?),
            ('cat-pot', ?, 'Holiday', ?)`,
      args: [USER, now, USER, now, USER, now],
    });

    // 2. Insert transaction linked to cat-tx
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, created_at)
            VALUES ('tx-1', ?, 'acc-1', '2026-05-01', 'Supermarket', -50, 'expense', 'cat-tx', ?)`,
      args: [USER, now],
    });

    // 3. Insert recurring transaction linked to cat-rec
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, start_date, category_id, created_at)
            VALUES ('rec-1', ?, 'acc-1', 'Monthly Rent', -1000, 'expense', 'monthly', '2026-01-01', 'cat-rec', ?)`,
      args: [USER, now],
    });

    // 4. Insert pot (transaction group) linked to cat-pot
    await testDb.client.execute({
      sql: `INSERT INTO transaction_groups (id, user_id, name, category_id, created_at)
            VALUES ('pot-1', ?, 'Summer Vacation', 'cat-pot', ?)`,
      args: [USER, now],
    });

    // 5. Insert category rule linked to cat-tx (cascading FK)
    await testDb.client.execute({
      sql: `INSERT INTO category_rules (id, user_id, pattern, category_id, match_type, match_field, created_at)
            VALUES ('rule-1', ?, 'supermarket', 'cat-tx', 'contains', 'both', ?)`,
      args: [USER, now],
    });

    // 6. Delete all three categories in bulk
    const res = await deleteCategories(["cat-tx", "cat-rec", "cat-pot"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, deleted: 3 });

    // Verify categories are deleted
    const remainingCats = (
      await testDb.client.execute({
        sql: `SELECT id FROM categories WHERE user_id = ?`,
        args: [USER],
      })
    ).rows;
    expect(remainingCats).toHaveLength(0);

    // Verify transaction had FK dropped and category_label preserved
    const txRow = (
      await testDb.client.execute(
        `SELECT category_id, category_label FROM transactions WHERE id = 'tx-1'`,
      )
    ).rows[0];
    expect(txRow.category_id).toBeNull();
    expect(txRow.category_label).toBe("Groceries");

    // Verify recurring transaction category_id was set to null
    const recRow = (
      await testDb.client.execute(
        `SELECT category_id FROM recurring_transactions WHERE id = 'rec-1'`,
      )
    ).rows[0];
    expect(recRow.category_id).toBeNull();

    // Verify pot category_id was set to null
    const potRow = (
      await testDb.client.execute(
        `SELECT category_id FROM transaction_groups WHERE id = 'pot-1'`,
      )
    ).rows[0];
    expect(potRow.category_id).toBeNull();

    // Verify category rule was cascaded and deleted
    const ruleRows = (
      await testDb.client.execute(
        `SELECT id FROM category_rules WHERE id = 'rule-1'`,
      )
    ).rows;
    expect(ruleRows).toHaveLength(0);
  });

  it("deletes categories with linked budgets, budget sub-lines, and budget month targets", async () => {
    const now = new Date().toISOString();

    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
            VALUES ('plan-1', ?, 'Main Plan', 1, ?, ?)`,
      args: [USER, now, now],
    });

    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES
            ('cat-budget', ?, 'Transport', ?)`,
      args: [USER, now],
    });

    await testDb.client.execute({
      sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, created_at)
            VALUES ('b-1', ?, 'plan-1', 'cat-budget', 200, 'monthly', ?)`,
      args: [USER, now],
    });

    await testDb.client.execute({
      sql: `INSERT INTO budget_sub_lines (id, user_id, allocation_id, name, amount, created_at)
            VALUES ('sl-1', ?, 'b-1', 'Gas', 100, ?)`,
      args: [USER, now],
    });

    await testDb.client.execute({
      sql: `INSERT INTO budget_month_targets (id, user_id, budget_id, category_id, year, month_index, target, frozen_at)
            VALUES ('bmt-1', ?, 'plan-1', 'cat-budget', 2026, 5, 200, ?)`,
      args: [USER, now],
    });

    const res = await deleteCategories(["cat-budget"]);
    expect(res.status).toBe(200);

    const bRows = (await testDb.client.execute(`SELECT id FROM budgets WHERE id = 'b-1'`)).rows;
    expect(bRows).toHaveLength(0);

    const slRows = (await testDb.client.execute(`SELECT id FROM budget_sub_lines WHERE id = 'sl-1'`)).rows;
    expect(slRows).toHaveLength(0);

    const bmtRows = (await testDb.client.execute(`SELECT id FROM budget_month_targets WHERE id = 'bmt-1'`)).rows;
    expect(bmtRows).toHaveLength(0);
  });

  it("returns 400 when no category id is provided", async () => {
    const res = await deleteCategories([]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Category ID is required");
  });
});
