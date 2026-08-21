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

const MEMBER = "categories-route-member";

/** Owner USER shares acc-1 with MEMBER as editor, and owns one category. */
async function seedSharedAccount() {
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, 'Member', 'member@test.dev', ?, ?)`,
    args: [MEMBER, Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('m-1', 'acc-1', ?, 'member@test.dev', 'editor', ?, ?)`,
    args: [MEMBER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-owner', ?, 'Groceries', ?)`,
    args: [USER, now],
  });
  // A same-named category of the member's own — must NOT be what the picker
  // offers when the target account is the owner's.
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-member', ?, 'Groceries', ?)`,
    args: [MEMBER, now],
  });
}

describe("categories scoping on shared accounts", () => {
  it("GET ?accountId= lists the account OWNER's categories, not the caller's", async () => {
    await seedSharedAccount();
    actor = MEMBER;
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("http://x/api/categories?accountId=acc-1") as any);
    expect(res.status).toBe(200);
    expect((await res.json()).map((c: { id: string }) => c.id)).toEqual(["cat-owner"]);
  });

  it("GET without accountId still lists the caller's own categories", async () => {
    await seedSharedAccount();
    actor = MEMBER;
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("http://x/api/categories") as any);
    expect((await res.json()).map((c: { id: string }) => c.id)).toEqual(["cat-member"]);
  });

  it("GET ?scope=visible returns own + sharing owners' categories, without their counts", async () => {
    await seedSharedAccount();
    const now = new Date().toISOString();
    // An owner transaction on the shared account: its tally is the owner's
    // business, not something the member's picker should report.
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, created_at)
            VALUES ('tx-1', ?, 'acc-1', '2026-05-01', 'Supermarket', -50, 'expense', 'cat-owner', ?)`,
      args: [USER, now],
    });
    actor = MEMBER;
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("http://x/api/categories?scope=visible") as any);
    const body = await res.json();
    expect(body.map((c: { id: string }) => c.id).sort()).toEqual(["cat-member", "cat-owner"]);
    expect(body.find((c: { id: string }) => c.id === "cat-owner").transactionCount).toBe(0);
  });

  it("GET ?accountId= 404s for an account the caller can't see", async () => {
    await seedSharedAccount();
    await testDb.client.execute(`UPDATE account_members SET revoked_at = '2026-01-01' WHERE id = 'm-1'`);
    actor = MEMBER;
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("http://x/api/categories?accountId=acc-1") as any);
    expect(res.status).toBe(404);
  });

  it("POST with accountId creates the category in the owner's space", async () => {
    await seedSharedAccount();
    actor = MEMBER;
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: "Fuel", accountId: "acc-1" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).userId).toBe(USER);
  });
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

describe("category kind", () => {
  it("POST without kind defaults to expense", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: "Groceries" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).kind).toBe("expense");
  });

  it("POST accepts an allowlisted kind", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: "Salary", kind: "income" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).kind).toBe("income");
  });

  it("POST rejects a kind outside the allowlist", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: "Bogus", kind: "savings" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
  });

  it("GET returns kind on every category", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-transfer', ?, 'Internal Transfer', 'transfer', ?)`,
      args: [USER, now],
    });
    const { GET } = await import("./route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("http://x/api/categories") as any);
    const body = await res.json();
    expect(body.find((c: { id: string }) => c.id === "cat-transfer").kind).toBe("transfer");
  });

  it("PUT updates kind", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-kind', ?, 'Freelance', 'expense', ?)`,
      args: [USER, now],
    });
    const { PUT } = await import("./route");
    const res = await PUT(
      new Request("http://x/api/categories", {
        method: "PUT",
        body: JSON.stringify({ id: "cat-kind", kind: "income" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe("income");
  });

  it("PUT rejects a kind outside the allowlist", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-kind-2', ?, 'Freelance', 'expense', ?)`,
      args: [USER, now],
    });
    const { PUT } = await import("./route");
    const res = await PUT(
      new Request("http://x/api/categories", {
        method: "PUT",
        body: JSON.stringify({ id: "cat-kind-2", kind: "bogus" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
  });
});
