import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("yearly-view");

const { getYearlyBudgetView, normaliseMonthIndex } = await import(
  "@/lib/yearly-budget-view"
);
const { db } = await import("@/db");
const {
  accounts,
  budgetPlans,
  budgets,
  categories,
  transactions,
} = await import("@/db/schema");

const USER = "user-1";
const YEAR = 2026;
const IN_JULY = new Date(2026, 6, 15);
let seq = 0;

const PLAN = {
  id: "plan-1",
  name: "Main",
  isMain: true,
  period: "yearly" as const,
  periodStartedAt: null,
  accountIds: ["acct-1"],
};

async function expense(date: string, amount: number, categoryId = "c-food") {
  await db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: USER,
    accountId: "acct-1",
    date,
    description: "t",
    amount: -amount,
    type: "expense",
    categoryId,
  });
}

beforeEach(async () => {
  await testDb.reset();
  await db.insert(budgetPlans).values({
    id: PLAN.id,
    userId: USER,
    name: "Main",
    isMain: true,
    period: "yearly",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
  await db.insert(accounts).values({
    id: "acct-1",
    userId: USER,
    name: "Checking",
    type: "checking",
    budgetId: PLAN.id,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
  await db.insert(categories).values([
    { id: "c-food", userId: USER, name: "Food", color: "#f00", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "c-fun", userId: USER, name: "Fun", color: "#0f0", createdAt: "2025-01-01T00:00:00.000Z" },
  ]);
  await db.insert(budgets).values([
    {
      id: "b-food",
      userId: USER,
      budgetId: PLAN.id,
      categoryId: "c-food",
      amount: 100,
      period: "monthly",
      isActive: true,
      status: "active",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: "b-fun",
      userId: USER,
      budgetId: PLAN.id,
      categoryId: "c-fun",
      amount: 50,
      period: "monthly",
      isActive: true,
      status: "active",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ]);
});
afterAll(() => testDb.cleanup());

describe("getYearlyBudgetView", () => {
  it("reports the envelope, the carry-over and the month in view", async () => {
    // Jan–Jun spent 50/month against 100 — six months of 50 saved.
    for (const month of ["01", "02", "03", "04", "05", "06"]) {
      await expense(`2026-${month}-10`, 50);
    }

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    const food = view.categories.find((c) => c.categoryId === "c-food")!;

    expect(food.annualAmount).toBe(1200);
    expect(food.spentYear).toBe(300);
    expect(food.remainingYear).toBe(900);
    expect(food.rolloverIn).toBe(300);
    // July may spend its own 100 plus the 300 the first half saved.
    expect(food.allowance).toBe(400);
    expect(food.monthTarget).toBe(100);
    expect(food.status).toBe("ok");
    expect(food.months).toHaveLength(12);
  });

  it("flags a month that outruns its allowance in amber", async () => {
    // Jan–Jun spent exactly on target, so July starts with nothing banked.
    for (const month of ["01", "02", "03", "04", "05", "06"]) {
      await expense(`2026-${month}-10`, 100);
    }
    await expense("2026-07-02", 250);

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    const food = view.categories.find((c) => c.categoryId === "c-food")!;
    expect(food.status).toBe("month-over");
    expect(food.remainingYear).toBeGreaterThan(0);
  });

  it("flags an exhausted annual pot in red", async () => {
    await expense("2026-07-02", 1300);

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    const food = view.categories.find((c) => c.categoryId === "c-food")!;
    expect(food.status).toBe("year-over");
    expect(food.remainingYear).toBeLessThan(0);
  });

  it("totals every category into the plan-level figures", async () => {
    await expense("2026-01-10", 30, "c-food");
    await expense("2026-01-10", 20, "c-fun");

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 0, 1, IN_JULY);
    expect(view.totals.annualPot).toBe(1200 + 600);
    expect(view.totals.spentYear).toBe(50);
    expect(view.totals.remainingYear).toBe(1750);
    expect(view.totals.spentThisMonth).toBe(50);
    expect(view.totals.allowanceThisMonth).toBe(150);
  });

  it("gives charts a full twelve-month series even for a late category", async () => {
    await db
      .update(budgets)
      .set({ createdAt: "2026-07-04T00:00:00.000Z" })
      .where(and(eq(budgets.userId, USER), eq(budgets.id, "b-fun")));

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    const fun = view.categories.find((c) => c.categoryId === "c-fun")!;
    expect(fun.months).toHaveLength(12);
    // Padded months carry no budget rather than being absent.
    expect(fun.months[0]).toMatchObject({ target: 0, allowance: 0 });
    expect(fun.annualAmount).toBe(300);
  });

  it("carries category name and colour for rendering", async () => {
    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    expect(view.categories.map((c) => c.categoryName)).toEqual(["Food", "Fun"]);
    expect(view.categories[0].categoryColor).toBe("#f00");
  });

  it("comes back empty for a plan with no allocations", async () => {
    await db.delete(budgets).where(eq(budgets.userId, USER));

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    expect(view.categories).toEqual([]);
    expect(view.totals.annualPot).toBe(0);
  });

  it("has the figures on the very first read, with nothing precomputed", async () => {
    await expense("2026-01-10", 60);

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 0, 1, IN_JULY);
    const food = view.categories.find((c) => c.categoryId === "c-food")!;
    expect(food.spentMonth).toBe(60);
    expect(food.annualAmount).toBe(1200);
  });

  it("exposes the month window being viewed", async () => {
    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    expect(view).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
      monthFrom: "2026-07-01",
      monthTo: "2026-07-31",
    });
  });

  it("includes the annual income figure", async () => {
    await db.insert(transactions).values({
      id: "tx-income",
      userId: USER,
      accountId: "acct-1",
      date: "2026-05-25",
      description: "salary",
      amount: 6000,
      type: "income",
    });

    const view = await getYearlyBudgetView(USER, PLAN, YEAR, 6, 1, IN_JULY);
    expect(view.income.actual).toBe(6000);
    expect(view.income.total).toBe(6000);
  });
});

describe("normaliseMonthIndex", () => {
  it("defaults to the month in progress", () => {
    expect(normaliseMonthIndex(null, 2026, 1, IN_JULY)).toBe(6);
  });

  it("keeps a valid explicit month", () => {
    expect(normaliseMonthIndex(2, 2026, 1, IN_JULY)).toBe(2);
  });

  it("clamps nonsense into the year", () => {
    expect(normaliseMonthIndex(99, 2026, 1, IN_JULY)).toBe(11);
    expect(normaliseMonthIndex(-5, 2026, 1, IN_JULY)).toBe(0);
  });

  it("lands on the last month of a year that is over, and the first of one to come", () => {
    expect(normaliseMonthIndex(null, 2025, 1, IN_JULY)).toBe(11);
    expect(normaliseMonthIndex(null, 2027, 1, IN_JULY)).toBe(0);
  });
});
