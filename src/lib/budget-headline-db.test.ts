/**
 * The budget headline must reconcile with the rows beneath it.
 *
 * Both the dashboard card (`getBudgetOverview`) and the Budgets page
 * (`GET /api/budgets`) show a "spent X of Y" bar above a list of budget rows.
 * Y has to be what those rows add up to — a recurring bill that a category's
 * own allocation already covers is ONE budget line, not two, and a yearly
 * envelope that has run itself into debt has a cap of nothing rather than a
 * negative one.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("budget-headline");

const { getBudgetOverview } = await import("@/app/(app)/_lib/dashboard-queries");
const { db } = await import("@/db");
const {
  accounts,
  budgetPlans,
  budgetSubLines,
  budgets,
  categories,
  recurringTransactions,
  transactionGroups,
  transactions,
} = await import("@/db/schema");

const USER = "headline-user";
const OTHER = "headline-other";
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = Number(TODAY.slice(0, 4));
let seq = 0;

function expense(
  amount: number,
  opts: {
    categoryId?: string;
    groupId?: string;
    accountId?: string;
    date?: string;
    recurringTransactionId?: string;
  } = {},
) {
  return db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: USER,
    accountId: opts.accountId ?? "acc-main",
    date: opts.date ?? TODAY,
    description: "t",
    amount,
    type: "expense",
    categoryId: opts.categoryId,
    groupId: opts.groupId,
    recurringTransactionId: opts.recurringTransactionId,
  });
}

/** A €1.000/month rent plan on the plan's account, in `categoryId`. */
function rentPlan(categoryId: string | null, amount = -1000, id = `rec-${++seq}`) {
  return db.insert(recurringTransactions).values({
    id,
    userId: USER,
    accountId: "acc-main",
    description: "Rent",
    amount,
    type: "expense",
    categoryId,
    frequency: "monthly",
    startDate: `${YEAR}-01-01`,
  });
}

/** What `budgetItems` adds up to — the invariant the headline has to match. */
const rowTotal = (items: { limit: number }[]) =>
  items.reduce((sum, i) => sum + i.limit, 0);

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES ('${USER}','A','a@test.dev'), ('${OTHER}','B','b@test.dev')`,
  );
  await db.insert(budgetPlans).values({
    id: "plan-1",
    userId: USER,
    name: "Main",
    isMain: true,
  });
  await db.insert(accounts).values([
    {
      id: "acc-main",
      userId: USER,
      name: "Main",
      type: "checking",
      budgetId: "plan-1",
    },
    // Outside the plan: its spending must never reach these numbers.
    { id: "acc-loose", userId: USER, name: "Loose", type: "savings" },
  ]);
  await db.insert(categories).values([
    { id: "cat-rent", userId: USER, name: "Rent" },
    { id: "cat-food", userId: USER, name: "Food" },
    { id: "cat-fun", userId: USER, name: "Fun" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("getBudgetOverview — the headline equals its rows", () => {
  it("holds for a plain allocation", async () => {
    await db.insert(budgets).values({
      id: "b-food",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-food",
      amount: 400,
      period: "monthly",
    });
    await expense(-120, { categoryId: "cat-food" });

    const r = await getBudgetOverview(USER, 1);

    expect(r.totalBudgeted).toBe(400);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
    expect(r.totalBudgetSpent).toBe(120);
  });

  it("holds for a recurring bill in a category nothing allocates", async () => {
    await rentPlan("cat-rent");

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems.map((i) => [i.categoryId, i.limit])).toEqual([
      ["cat-rent", 1000],
    ]);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
  });

  it("counts a bill absorbed by its category's allocation exactly once", async () => {
    // What POST /api/budgets writes for a sub-line that IS a recurring plan:
    // the plan, the sub-line linked to it, and an allocation rolled up from it.
    await rentPlan("cat-rent", -1000, "rec-rent");
    await db.insert(budgets).values({
      id: "b-rent",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-rent",
      amount: 1000,
      period: "monthly",
    });
    await db.insert(budgetSubLines).values({
      id: "sl-rent",
      userId: USER,
      allocationId: "b-rent",
      name: "Rent",
      amount: 1000,
      recurringTransactionId: "rec-rent",
    });

    const r = await getBudgetOverview(USER, 1);

    // One row at 1.000 — not a second fixed-cost row, and not 2.000 budgeted.
    expect(r.budgetItems.map((i) => [i.categoryId, i.limit])).toEqual([
      ["cat-rent", 1000],
    ]);
    expect(r.totalBudgeted).toBe(1000);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
  });

  it("still counts the bills of categories that have no allocation", async () => {
    await rentPlan("cat-rent");
    await rentPlan("cat-fun", -50);
    await db.insert(budgets).values({
      id: "b-rent",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-rent",
      amount: 1000,
      period: "monthly",
    });

    const r = await getBudgetOverview(USER, 1);

    expect(r.totalBudgeted).toBe(1050);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
  });

  it("keeps several plans in one unallocated category on one row", async () => {
    await rentPlan("cat-rent", -600);
    await rentPlan("cat-rent", -400);

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems).toHaveLength(1);
    expect(r.budgetItems[0].limit).toBe(1000);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
  });

  it("normalises a weekly plan to the month on both sides of the bar", async () => {
    await db.insert(recurringTransactions).values({
      id: "rec-weekly",
      userId: USER,
      accountId: "acc-main",
      description: "Cleaner",
      amount: -25,
      type: "expense",
      categoryId: "cat-fun",
      frequency: "weekly",
      startDate: `${YEAR}-01-01`,
    });

    const r = await getBudgetOverview(USER, 1);

    expect(r.totalBudgeted).toBeCloseTo(25 * 4.33, 6);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
  });

  it("drops a plan with no category from both the rows and the headline", async () => {
    // Nothing can render a row for it, so counting it in the bar put money in
    // the headline and in no list at all.
    await rentPlan(null);

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems).toEqual([]);
    expect(r.totalBudgeted).toBe(0);
  });

  it("ignores plans and allocations outside the plan's accounts", async () => {
    await db.insert(recurringTransactions).values({
      id: "rec-loose",
      userId: USER,
      accountId: "acc-loose",
      description: "Netflix",
      amount: -15,
      type: "expense",
      categoryId: "cat-fun",
      frequency: "monthly",
      startDate: `${YEAR}-01-01`,
    });
    await expense(-99, { categoryId: "cat-food", accountId: "acc-loose" });

    const r = await getBudgetOverview(USER, 1);

    expect(r.totalBudgeted).toBe(0);
    expect(r.unbudgetedTotal).toBe(0);
  });

  it("holds with pots, reimbursements and splits all in play", async () => {
    await db.insert(budgets).values({
      id: "b-food",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-food",
      amount: 500,
      period: "monthly",
    });
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: USER,
      name: "Trip",
      categoryId: "cat-food",
    });
    await expense(-200, { groupId: "pot-1" });
    await expense(-50, { categoryId: "cat-food" });
    // A split: only the children count toward spend.
    await db.insert(transactions).values({
      id: "tx-parent",
      userId: USER,
      accountId: "acc-main",
      date: TODAY,
      description: "shop",
      amount: -100,
      type: "expense",
      isSplitParent: true,
    });
    await db.insert(transactions).values([
      {
        id: "tx-child-1",
        userId: USER,
        accountId: "acc-main",
        date: TODAY,
        description: "shop",
        amount: -70,
        type: "expense",
        categoryId: "cat-food",
        parentTransactionId: "tx-parent",
      },
      {
        id: "tx-child-2",
        userId: USER,
        accountId: "acc-main",
        date: TODAY,
        description: "shop",
        amount: -30,
        type: "expense",
        categoryId: "cat-fun",
        parentTransactionId: "tx-parent",
      },
    ]);

    const r = await getBudgetOverview(USER, 1);

    expect(r.totalBudgeted).toBe(500);
    expect(r.totalBudgeted).toBe(rowTotal(r.budgetItems));
    // 200 pot + 50 direct + 70 split child, all in the budgeted category.
    expect(r.budgetItems[0].spent).toBe(320);
    expect(r.totalBudgetSpent).toBe(320);
    // The other child's category has no budget.
    expect(r.unbudgetedTotal).toBe(30);
  });
});

describe("getBudgetOverview — a cap of nothing is not a healthy cap", () => {
  it("reports spending against a zero allocation as exceeded", async () => {
    await db.insert(budgets).values({
      id: "b-zero",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-food",
      amount: 0,
      period: "monthly",
    });
    await expense(-40, { categoryId: "cat-food" });

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems[0]).toMatchObject({
      limit: 0,
      spent: 40,
      percentage: 100,
      status: "exceeded",
    });
  });

  it("leaves a zero allocation with no spend alone", async () => {
    await db.insert(budgets).values({
      id: "b-zero",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-food",
      amount: 0,
      period: "monthly",
    });

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems[0]).toMatchObject({ percentage: 0, status: "ok" });
  });

  it("floors a yearly envelope that has already spent the whole year at zero", async () => {
    await testDb.client.execute(
      `UPDATE budget_plans SET period='yearly', period_started_at='${YEAR}-01-01'
         WHERE id='plan-1' AND user_id='${USER}'`,
    );
    await db.insert(budgets).values({
      id: "b-food",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-food",
      amount: 100,
      period: "monthly",
      createdAt: `${YEAR}-01-01T00:00:00.000Z`,
    });
    // €5.000 gone in January against a €1.200 envelope: every later month
    // inherits a deep negative rollover.
    await expense(-5000, { categoryId: "cat-food", date: `${YEAR}-01-15` });

    const r = await getBudgetOverview(USER, 1);

    // A cap cannot be negative; it is zero, and the headline stays usable.
    expect(r.budgetItems[0].limit).toBe(0);
    expect(r.totalBudgeted).toBe(0);
    expect(r.totalBudgeted).toBeGreaterThanOrEqual(0);
  });

  it("calls a month over when the envelope is empty and it spends anyway", async () => {
    await testDb.client.execute(
      `UPDATE budget_plans SET period='yearly', period_started_at='${YEAR}-01-01'
         WHERE id='plan-1' AND user_id='${USER}'`,
    );
    await db.insert(budgets).values({
      id: "b-food",
      userId: USER,
      budgetId: "plan-1",
      categoryId: "cat-food",
      amount: 100,
      period: "monthly",
      createdAt: `${YEAR}-01-01T00:00:00.000Z`,
    });
    await expense(-5000, { categoryId: "cat-food", date: `${YEAR}-01-15` });
    await expense(-10, { categoryId: "cat-food" });

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems[0]).toMatchObject({
      limit: 0,
      spent: 10,
      status: "exceeded",
    });
  });
});
