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

const getBudgets = (query = "") =>
  import("./route").then(({ GET }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GET(new Request(`http://x/api/budgets?${query}`) as any),
  );

// The current financial month with the default startDay of 1, pinned to a
// mid-month day so a timezone shift can't push a row out of the window.
const TODAY = new Date();
const YM = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
const MONTH_QUERY = `dateFrom=${YM}-01&dateTo=${YM}-28&noScale=1`;
const MID_MONTH = `${YM}-15`;

const addCategory = (id: string, name: string, kind = "income") =>
  testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, color, kind, created_at) VALUES (?, ?, ?, '#00ff00', ?, ?)`,
    args: [id, OWNER, name, kind, new Date().toISOString()],
  });

const addRecurring = (opts: {
  id: string;
  amount: number;
  type: "income" | "expense";
  categoryId?: string | null;
  description?: string;
  isActive?: boolean;
}) =>
  testDb.client.execute({
    sql: `INSERT INTO recurring_transactions
            (id, user_id, account_id, description, amount, type, category_id, frequency, start_date, is_active, created_at)
          VALUES (?, ?, 'acc-shared', ?, ?, ?, ?, 'monthly', ?, ?, ?)`,
    args: [
      opts.id,
      OWNER,
      opts.description ?? opts.id,
      opts.amount,
      opts.type,
      opts.categoryId ?? null,
      `${YM}-01`,
      opts.isActive === false ? 0 : 1,
      new Date().toISOString(),
    ],
  });

const addTransaction = (opts: {
  id: string;
  amount: number;
  type: string;
  categoryId?: string | null;
  date?: string;
}) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, category_id, type, created_at)
          VALUES (?, ?, 'acc-shared', ?, ?, ?, ?, ?, ?)`,
    args: [
      opts.id,
      OWNER,
      opts.date ?? MID_MONTH,
      opts.id,
      opts.amount,
      opts.categoryId ?? null,
      opts.type,
      new Date().toISOString(),
    ],
  });

interface IncomeLineDto {
  categoryId: string;
  categoryName: string;
  expected: number;
  received: number;
  avgMonthly: number;
  avgMonths: number;
  items: { description: string; monthlyAmount: number }[];
  year?: { expected: number; received: number };
}

const lineFor = (body: { incomeLines: IncomeLineDto[] }, categoryId: string) =>
  body.incomeLines.find((l) => l.categoryId === categoryId);

describe("GET /api/budgets — recurring income lines", () => {
  it("groups recurring income by category with its plans listed as items", async () => {
    await addCategory("cat-salary", "Salary");
    await addCategory("cat-rent-in", "Rental income");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary", description: "Salary" });
    await addRecurring({ id: "rec-2", amount: 250, type: "income", categoryId: "cat-salary", description: "Bonus" });
    await addRecurring({ id: "rec-3", amount: 800, type: "income", categoryId: "cat-rent-in", description: "Tenant" });

    const body = await (await getBudgets(MONTH_QUERY)).json();

    expect(body.incomeLines).toHaveLength(2);
    const salary = lineFor(body, "cat-salary")!;
    expect(salary.categoryName).toBe("Salary");
    expect(salary.expected).toBe(3250);
    expect(salary.items.map((i) => i.description).sort()).toEqual(["Bonus", "Salary"]);
    expect(lineFor(body, "cat-rent-in")!.expected).toBe(800);
    // Unchanged headline: the sum of every plan, however it is grouped.
    expect(body.monthlyIncome).toBe(4050);
  });

  it("fills `received` from real income transactions, ignoring reimbursements and transfers", async () => {
    await addCategory("cat-salary", "Salary");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-1", amount: 2900, type: "income", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-2", amount: 100, type: "income", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-3", amount: 500, type: "reimbursement", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-4", amount: 700, type: "internal_transfer", categoryId: "cat-salary" });
    // Outside the requested window.
    await addTransaction({ id: "tx-5", amount: 999, type: "income", categoryId: "cat-salary", date: "2000-06-15" });

    const body = await (await getBudgets(MONTH_QUERY)).json();
    expect(lineFor(body, "cat-salary")!.received).toBe(3000);
  });

  it("surfaces income that landed in a category no plan covers, expecting nothing", async () => {
    await addCategory("cat-salary", "Salary");
    await addCategory("cat-bonus", "Side gig");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    // No recurring plan behind this one — a windfall, not a shortfall.
    await addTransaction({ id: "tx-2", amount: 420, type: "income", categoryId: "cat-bonus" });

    const body = await (await getBudgets(MONTH_QUERY)).json();

    const bonus = lineFor(body, "cat-bonus")!;
    expect(bonus).toBeDefined();
    expect(bonus.categoryName).toBe("Side gig");
    expect(bonus.expected).toBe(0);
    expect(bonus.received).toBe(420);
    expect(bonus.items).toEqual([]);
    // The planned line is untouched by the addition.
    expect(lineFor(body, "cat-salary")!.expected).toBe(3000);
  });

  it("does not invent a line for a category that received nothing", async () => {
    await addCategory("cat-salary", "Salary");
    await addCategory("cat-quiet", "Dormant");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });

    const body = await (await getBudgets(MONTH_QUERY)).json();
    expect(lineFor(body, "cat-quiet")).toBeUndefined();
    expect(body.incomeLines).toHaveLength(1);
  });

  it("keeps plans with no category in an `uncategorized` line, matched to uncategorized income", async () => {
    await addRecurring({ id: "rec-1", amount: 400, type: "income", categoryId: null, description: "Side gig" });
    await addTransaction({ id: "tx-1", amount: 375, type: "income", categoryId: null });

    const body = await (await getBudgets(MONTH_QUERY)).json();
    const line = lineFor(body, "uncategorized")!;
    expect(line.expected).toBe(400);
    expect(line.received).toBe(375);
  });

  it("a paused income plan contributes nothing to `expected`", async () => {
    await addCategory("cat-salary", "Salary");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    await addRecurring({ id: "rec-2", amount: 500, type: "income", categoryId: "cat-salary", isActive: false });

    const body = await (await getBudgets(MONTH_QUERY)).json();
    const salary = lineFor(body, "cat-salary")!;
    expect(salary.expected).toBe(3000);
    expect(salary.items).toHaveLength(1);
  });

  it("`received` does not move availableToAllocate — the budget still runs on expected income", async () => {
    await addCategory("cat-salary", "Salary");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    await addRecurring({ id: "rec-2", amount: 1200, type: "expense", categoryId: "cat-x" });

    const before = await (await getBudgets(MONTH_QUERY)).json();
    expect(before.availableToAllocate).toBe(1800);

    // A fat month: far more income lands than was planned.
    await addTransaction({ id: "tx-1", amount: 5000, type: "income", categoryId: "cat-salary" });
    const after = await (await getBudgets(MONTH_QUERY)).json();

    expect(lineFor(after, "cat-salary")!.received).toBe(5000);
    expect(after.availableToAllocate).toBe(before.availableToAllocate);
    expect(after.monthlyIncome).toBe(before.monthlyIncome);
    expect(after.unallocated).toBe(before.unallocated);
  });

  it("leaves `year` undefined on a monthly plan", async () => {
    await addCategory("cat-salary", "Salary");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });

    const body = await (await getBudgets(MONTH_QUERY)).json();
    expect(lineFor(body, "cat-salary")!.year).toBeUndefined();
  });

  it("annualises expected and sums the financial year's income for a yearly plan", async () => {
    await testDb.client.execute({
      sql: `UPDATE budget_plans SET period = 'yearly' WHERE id = 'plan-x'`,
      args: [],
    });
    await addCategory("cat-salary", "Salary");
    await addRecurring({ id: "rec-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-1", amount: 3000, type: "income", categoryId: "cat-salary" });
    await addTransaction({ id: "tx-2", amount: 3100, type: "income", categoryId: "cat-salary", date: `${YM}-16` });

    const body = await (await getBudgets(MONTH_QUERY)).json();
    const salary = lineFor(body, "cat-salary")!;
    expect(salary.year).toEqual({ expected: 36000, received: 6100 });
  });
});

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

// One category, two plans: budgeting it in the second must not touch the
// first, and each plan's GET must see only its own row — the "add allocation"
// picker filters on exactly that list.
describe("POST /api/budgets — the same category across plans", () => {
  const addSecondPlan = async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, created_at, updated_at)
            VALUES ('plan-y', ?, 'Holiday', 0, ?, ?)`,
      args: [OWNER, now, now],
    });
  };

  it("allocates the same category in two plans as two independent rows", async () => {
    await addSecondPlan();
    expect(
      (await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" })).status,
    ).toBe(201);
    expect(
      (await postAllocation({ categoryId: "cat-x", amount: 25, budgetId: "plan-y" })).status,
    ).toBe(201);

    const x = await (await getBudgets(`budgetId=plan-x&${MONTH_QUERY}`)).json();
    const y = await (await getBudgets(`budgetId=plan-y&${MONTH_QUERY}`)).json();
    expect(x.allocations.map((a: { amount: number }) => a.amount)).toEqual([100]);
    expect(y.allocations.map((a: { amount: number }) => a.amount)).toEqual([25]);
  });

  it("budgeting a category twice in ONE plan updates the row instead of adding a second", async () => {
    await postAllocation({ categoryId: "cat-x", amount: 100, budgetId: "plan-x" });
    const again = await postAllocation({ categoryId: "cat-x", amount: 140, budgetId: "plan-x" });
    expect(again.status).toBe(200);

    const { allocations } = await (await getBudgets(`budgetId=plan-x&${MONTH_QUERY}`)).json();
    expect(allocations).toHaveLength(1);
    expect(allocations[0].amount).toBe(140);
  });
});

// The atomic create: allocation + sub-line tree + the recurring plans some of
// those lines stand for, in one POST.
describe("POST /api/budgets — children tree", () => {
  const subLines = () =>
    testDb.client.execute(
      `SELECT id, parent_id, name, amount, recurring_transaction_id FROM budget_sub_lines ORDER BY name`,
    );
  const allocationAmount = async (id: string) =>
    (
      await testDb.client.execute({
        sql: `SELECT amount FROM budgets WHERE id = ?`,
        args: [id],
      })
    ).rows[0]?.amount;

  it("still creates a flat allocation when no children are submitted", async () => {
    const res = await postAllocation({ categoryId: "cat-x", amount: 120, budgetId: "plan-x" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await allocationAmount(id)).toBe(120);
    expect((await subLines()).rows).toHaveLength(0);
  });

  it("sets the allocation to the sum of its children, ignoring the submitted amount", async () => {
    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 999,
      budgetId: "plan-x",
      children: [
        { name: "Supermarket", amount: 300 },
        { name: "Market", amount: 50 },
      ],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await allocationAmount(id)).toBe(350);
    expect((await subLines()).rows.map((r) => r.amount)).toEqual([50, 300]);
  });

  it("rolls a nested tree up two levels", async () => {
    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [
        {
          name: "Food",
          amount: 1,
          children: [
            { name: "Supermarket", amount: 200 },
            {
              name: "Out",
              amount: 1,
              children: [
                { name: "Lunch", amount: 40 },
                { name: "Dinner", amount: 60 },
              ],
            },
          ],
        },
        { name: "Household", amount: 25 },
      ],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const byName = new Map(
      (await subLines()).rows.map((r) => [r.name as string, r.amount as number]),
    );
    expect(byName.get("Out")).toBe(100);
    expect(byName.get("Food")).toBe(300);
    expect(await allocationAmount(id)).toBe(325);
  });

  it("creates a signed recurring row for a `recurring` child and stores the line monthly", async () => {
    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [
        {
          name: "Insurance",
          amount: 1,
          recurring: {
            accountId: "acc-shared",
            amount: 600,
            frequency: "yearly",
            startDate: `${YM}-01`,
          },
        },
      ],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const line = (await subLines()).rows[0];
    // A €600 yearly bill is a €50 sub-line.
    expect(line.amount).toBe(50);
    expect(await allocationAmount(id)).toBe(50);

    const rec = (
      await testDb.client.execute({
        sql: `SELECT * FROM recurring_transactions WHERE id = ?`,
        args: [line.recurring_transaction_id],
      })
    ).rows[0];
    // Expenses are stored negative — a positive row would corrupt every total.
    expect(rec.amount).toBe(-600);
    expect(rec.type).toBe("expense");
    expect(rec.frequency).toBe("yearly");
    expect(rec.description).toBe("Insurance");
    expect(rec.category_id).toBe("cat-x");
    expect(rec.user_id).toBe(OWNER);
  });

  it("adopts an existing plan and takes its monthly amount", async () => {
    await addRecurring({ id: "rec-gym", amount: -40, type: "expense", categoryId: "cat-x" });
    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [{ name: "Gym", amount: 999, adoptRecurringId: "rec-gym" }],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const line = (await subLines()).rows[0];
    expect(line.recurring_transaction_id).toBe("rec-gym");
    expect(line.amount).toBe(40);
    expect(await allocationAmount(id)).toBe(40);
  });

  it("refuses to adopt a plan another sub-line already links", async () => {
    await addRecurring({ id: "rec-gym", amount: -40, type: "expense", categoryId: "cat-x" });
    await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [{ name: "Gym", amount: 40, adoptRecurringId: "rec-gym" }],
    });

    await addCategory("cat-other", "Sport", "expense");
    const res = await postAllocation({
      categoryId: "cat-other",
      amount: 1,
      budgetId: "plan-x",
      children: [{ name: "Gym again", amount: 40, adoptRecurringId: "rec-gym" }],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("recurring_already_linked");
    // The second allocation never happened.
    expect(
      (
        await testDb.client.execute(
          `SELECT id FROM budgets WHERE category_id = 'cat-other'`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("refuses to adopt another user's plan, writing nothing", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: ["outsider", "outsider", "outsider@test.dev", Date.now(), Date.now()],
    });
    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
            VALUES ('acc-outsider', 'outsider', 'Theirs', 'checking', 'EUR', 0, 0, ?, ?)`,
      args: [now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions
              (id, user_id, account_id, description, amount, type, frequency, start_date, is_active, created_at)
            VALUES ('rec-theirs', 'outsider', 'acc-outsider', 'Theirs', -99, 'expense', 'monthly', ?, 1, ?)`,
      args: [`${YM}-01`, now],
    });

    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [{ name: "Theirs", amount: 99, adoptRecurringId: "rec-theirs" }],
    });
    expect(res.status).toBe(404);
    expect((await testDb.client.execute(`SELECT id FROM budgets`)).rows).toHaveLength(0);
    expect((await subLines()).rows).toHaveLength(0);
  });

  it("rejects a tree deeper than the cap and leaves no partial rows behind", async () => {
    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [
        {
          name: "L1",
          amount: 1,
          children: [
            {
              name: "L2",
              amount: 1,
              children: [{ name: "L3", amount: 1, children: [{ name: "L4", amount: 10 }] }],
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_too_deep");
    expect((await testDb.client.execute(`SELECT id FROM budgets`)).rows).toHaveLength(0);
    expect((await subLines()).rows).toHaveLength(0);
  });

  it("rejects a tree over the count cap and leaves no partial rows behind", async () => {
    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: Array.from({ length: 101 }, (_, i) => ({ name: `L${i}`, amount: 1 })),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_too_many");
    expect((await testDb.client.execute(`SELECT id FROM budgets`)).rows).toHaveLength(0);
    expect((await subLines()).rows).toHaveLength(0);
  });

  it("counts the rows already under an allocation against the cap, writing nothing", async () => {
    const first = await (
      await postAllocation({
        categoryId: "cat-x",
        amount: 1,
        budgetId: "plan-x",
        children: Array.from({ length: 100 }, (_, i) => ({ name: `L${i}`, amount: 1 })),
      })
    ).json();

    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [{ name: "One too many", amount: 5 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_too_many");
    // The rejected call touched neither the tree nor the allocation's total.
    expect((await subLines()).rows).toHaveLength(100);
    expect(await allocationAmount(first.id)).toBe(100);
  });

  it("attaches children to an already-allocated category and re-sums it", async () => {
    const first = await (
      await postAllocation({
        categoryId: "cat-x",
        amount: 100,
        budgetId: "plan-x",
        children: [{ name: "Supermarket", amount: 100 }],
      })
    ).json();

    const res = await postAllocation({
      categoryId: "cat-x",
      amount: 5,
      budgetId: "plan-x",
      children: [{ name: "Market", amount: 60 }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(first.id);

    expect((await subLines()).rows).toHaveLength(2);
    expect(await allocationAmount(first.id)).toBe(160);
  });
});

describe("GET /api/budgets — linked sub-lines", () => {
  it("emits the recurring object on a linked line and omits it on a plain one", async () => {
    await addRecurring({ id: "rec-gym", amount: -40, type: "expense", categoryId: "cat-x" });
    await postAllocation({
      categoryId: "cat-x",
      amount: 1,
      budgetId: "plan-x",
      children: [
        { name: "Gym", amount: 40, adoptRecurringId: "rec-gym" },
        { name: "Snacks", amount: 10 },
      ],
    });

    const body = await (await getBudgets(`budgetId=plan-x&${MONTH_QUERY}`)).json();
    const lines: {
      name: string;
      amount: number;
      recurring?: { id: string; amount: number; frequency: string; isActive: boolean };
    }[] = body.allocations[0].subLines;

    const gym = lines.find((l) => l.name === "Gym")!;
    expect(gym.recurring).toEqual({
      id: "rec-gym",
      // Per occurrence, as stored — signed, unscaled.
      amount: -40,
      frequency: "monthly",
      dayOfWeek: null,
      dayOfMonth: null,
      monthOfYear: null,
      startDate: `${YM}-01`,
      isActive: true,
    });
    expect(lines.find((l) => l.name === "Snacks")!.recurring).toBeUndefined();
  });
});
