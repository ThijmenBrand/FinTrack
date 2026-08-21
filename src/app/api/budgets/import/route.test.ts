import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";
import type { ImportPayload } from "@/lib/budget-import";

const OWNER = "import-route-owner";
const STRANGER = "import-route-stranger";

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
  testDb = await setupTestDb("budgets-import-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  actor = OWNER;
  await testDb.reset();
  const now = new Date().toISOString();
  for (const id of [OWNER, STRANGER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@test.dev`, Date.now(), Date.now()],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
          VALUES ('plan-x', ?, 'Main', 1, ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
          VALUES ('acc-own', ?, 'Own', 'checking', 'EUR', 0, 0, 'plan-x', ?, ?),
                 ('acc-foreign', ?, 'Theirs', 'checking', 'EUR', 0, 0, NULL, ?, ?)`,
    args: [OWNER, now, now, STRANGER, now, now],
  });
});

const postImport = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/budgets/import", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const payload = (nodes: ImportPayload["nodes"], accountId = "acc-own"): ImportPayload => ({
  budgetId: "plan-x",
  accountId,
  startDate: "2026-08-01",
  nodes,
});

const rows = async (sql: string) => (await testDb.client.execute(sql)).rows;

describe("POST /api/budgets/import", () => {
  it("creates allocations, sub-lines and per-leaf recurring plans from one payload", async () => {
    const res = await postImport(
      payload([
        {
          type: "variable",
          name: "Groceries",
          amount: 400,
          children: [
            { name: "Supermarket", amount: 300, children: [] },
            { name: "Market", amount: 100, children: [] },
          ],
        },
        {
          type: "fixed",
          frequency: "monthly",
          name: "Housing",
          amount: null,
          children: [
            { name: "Rent", amount: 1200, children: [] },
            { name: "Energy", amount: 150, children: [] },
          ],
        },
        { type: "income", frequency: "monthly", name: "Salary", amount: 3000, children: [] },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      created: 1,
      subLinesCreated: 2,
      fixedPlansCreated: 2,
      incomePlansCreated: 1,
      createdCategories: 3,
      skipped: [],
    });

    // Only the variable root gets an allocation — fixed/income would
    // double-count against their plans.
    const allocs = await rows(
      `SELECT c.name, b.amount FROM budgets b JOIN categories c ON c.id = b.category_id`,
    );
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ name: "Groceries", amount: 400 });

    const plans = await rows(
      `SELECT description, amount, type, frequency, start_date, account_id, user_id, is_active,
              day_of_month, month_of_year
       FROM recurring_transactions ORDER BY description`,
    );
    expect(plans.map((p) => [p.description, p.type, p.amount])).toEqual([
      ["Energy", "expense", -150],
      ["Rent", "expense", -1200],
      ["Salary", "income", 3000],
    ]);
    expect(plans[0]).toMatchObject({
      frequency: "monthly",
      start_date: "2026-08-01",
      account_id: "acc-own",
      user_id: OWNER,
      is_active: 1,
      day_of_month: null,
      month_of_year: null,
    });
  });

  it("creates income categories with kind=income", async () => {
    await postImport(
      payload([
        { type: "income", frequency: "yearly", name: "Freelance", amount: 5000, children: [] },
      ]),
    );
    const [cat] = await rows(`SELECT kind FROM categories WHERE name = 'Freelance'`);
    expect(cat.kind).toBe("income");
    const [plan] = await rows(`SELECT frequency FROM recurring_transactions`);
    expect(plan.frequency).toBe("yearly");
  });

  it("skips a root whose category is already budgeted", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-g', ?, 'Groceries', 'expense', ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, created_at)
            VALUES ('b-g', ?, 'plan-x', 'cat-g', 250, 'monthly', ?)`,
      args: [OWNER, now],
    });

    const res = await postImport(
      payload([{ type: "variable", name: "Groceries", amount: 400, children: [] }]),
    );
    expect(await res.json()).toMatchObject({
      created: 0,
      skipped: [{ name: "Groceries", reason: "alreadyBudgeted" }],
    });
    expect(await rows(`SELECT id FROM budgets`)).toHaveLength(1);
  });

  it("only adds plans the account does not already have", async () => {
    // Recurring plans hang off the account, so a brand-new budget still meets
    // the salary that was already set up — importing it again must not double it.
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-s', ?, 'Salary', 'income', ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions
              (id, user_id, account_id, description, amount, type, category_id, frequency, start_date, is_active, created_at)
            VALUES ('r-1', ?, 'acc-own', 'Payslip', 3000, 'income', 'cat-s', 'monthly', '2026-01-01', 1, ?)`,
      args: [OWNER, now],
    });

    const res = await postImport(
      payload([
        {
          type: "income",
          frequency: "monthly",
          name: "Salary",
          amount: null,
          children: [
            { name: "Payslip", amount: 3000, children: [] },
            { name: "Bonus", amount: 200, children: [] },
          ],
        },
      ]),
    );
    expect(await res.json()).toMatchObject({ incomePlansCreated: 1, skipped: [] });
    expect(
      (await rows(`SELECT description FROM recurring_transactions ORDER BY description`)).map(
        (p) => p.description,
      ),
    ).toEqual(["Bonus", "Payslip"]);
  });

  it("reports a root whose plans all already exist", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-s', ?, 'Salary', 'income', ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions
              (id, user_id, account_id, description, amount, type, category_id, frequency, start_date, is_active, created_at)
            VALUES ('r-1', ?, 'acc-own', 'Salary', 3000, 'income', 'cat-s', 'monthly', '2026-01-01', 1, ?)`,
      args: [OWNER, now],
    });
    const res = await postImport(
      payload([
        { type: "income", frequency: "monthly", name: "Salary", amount: 3000, children: [] },
      ]),
    );
    expect(await res.json()).toMatchObject({
      incomePlansCreated: 0,
      skipped: [{ name: "Salary", reason: "alreadyBudgeted" }],
    });
    expect(await rows(`SELECT id FROM recurring_transactions`)).toHaveLength(1);
  });

  it("skips a root whose stored category kind is the other side of the ledger", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-f', ?, 'Freelance', 'expense', ?)`,
      args: [OWNER, new Date().toISOString()],
    });
    const res = await postImport(
      payload([
        { type: "income", frequency: "monthly", name: "Freelance", amount: 900, children: [] },
      ]),
    );
    expect(await res.json()).toMatchObject({
      skipped: [{ name: "Freelance", reason: "kindConflict" }],
    });
    expect(await rows(`SELECT id FROM recurring_transactions`)).toHaveLength(0);
  });

  it("rejects an account the caller has no access to", async () => {
    const res = await postImport(
      payload([{ type: "variable", name: "Groceries", amount: 400, children: [] }], "acc-foreign"),
    );
    expect(res.status).toBe(404);
    expect(await rows(`SELECT id FROM budgets`)).toHaveLength(0);

    const missing = await postImport(
      payload([{ type: "variable", name: "Groceries", amount: 400, children: [] }], "nope"),
    );
    expect(missing.status).toBe(404);
  });

  it("rejects a payload without a valid startDate or accountId", async () => {
    const noDate = await postImport({
      budgetId: "plan-x",
      accountId: "acc-own",
      startDate: "01-08-2026",
      nodes: [{ type: "variable", name: "Groceries", amount: 400, children: [] }],
    });
    expect(noDate.status).toBe(400);

    const noAccount = await postImport({
      budgetId: "plan-x",
      startDate: "2026-08-01",
      nodes: [{ type: "variable", name: "Groceries", amount: 400, children: [] }],
    });
    expect(noAccount.status).toBe(400);
  });

  it("rejects an unknown root type", async () => {
    const res = await postImport(
      payload([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: "sneaky" as any, name: "Groceries", amount: 400, children: [] },
      ]),
    );
    expect(res.status).toBe(400);
  });
});
