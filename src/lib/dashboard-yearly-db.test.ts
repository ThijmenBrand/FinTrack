import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("dashboard-yearly");

const { getBudgetOverview } = await import("@/app/(app)/_lib/dashboard-queries");
const { getFinancialYearMonths } = await import("@/lib/financial-year");
const { db } = await import("@/db");
const { accounts, budgetPlans, budgets, categories, transactions } =
  await import("@/db/schema");

const USER = "user-1";
const PLAN = "plan-1";
const START_DAY = 1;
const YEAR = 2026;
// Pinned so the carry-over the fixture builds is the same in every month of
// the real year: the dashboard reads "now" from the clock, not from an
// argument, and there is no carry-over to test in January.
const NOW = new Date(2026, 4, 15);
const MONTHS = getFinancialYearMonths(YEAR, START_DAY);

let seq = 0;

async function expense(date: string, amount: number) {
  await db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: USER,
    accountId: "acct-1",
    date,
    description: "groceries",
    amount: -amount,
    type: "expense",
    categoryId: "c-food",
  });
}

/**
 * Spend `amount` in each of the four months before May, which is what puts a
 * known carry-over into May: four months of 100 target, minus what they used.
 */
async function spendEachEarlierMonth(amount: number) {
  for (const month of MONTHS.slice(0, 4)) await expense(month.from, amount);
}

async function setPlanPeriod(period: "monthly" | "yearly") {
  await db
    .update(budgetPlans)
    .set({ period })
    .where(and(eq(budgetPlans.userId, USER), eq(budgetPlans.id, PLAN)));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  await testDb.reset();
  await db.insert(budgetPlans).values({
    id: PLAN,
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
    budgetId: PLAN,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
  await db.insert(categories).values({
    id: "c-food",
    userId: USER,
    name: "Food",
    createdAt: "2025-01-01T00:00:00.000Z",
  });
  await db.insert(budgets).values({
    id: "b-food",
    userId: USER,
    budgetId: PLAN,
    categoryId: "c-food",
    amount: 100,
    period: "monthly",
    isActive: true,
    status: "active",
    createdAt: "2025-01-01T00:00:00.000Z",
  });
  // 150 spent this month — over the flat allocation, under a carried-up one.
  await expense(MONTHS[4].from, 150);
});
afterAll(() => {
  vi.useRealTimers();
  return testDb.cleanup();
});

describe("dashboard budget card on a yearly plan", () => {
  it("uses the carry-over-adjusted allowance as the cap", async () => {
    // Jan–Apr spent nothing against 100/month, so May opens 400 up.
    const overview = await getBudgetOverview(USER, START_DAY, PLAN);

    expect(overview.budgetItems).toEqual([
      expect.objectContaining({
        categoryId: "c-food",
        spent: 150,
        limit: 500,
        status: "ok",
      }),
    ]);
    // Spending against the year's savings is not "over budget".
    expect(overview.budgetItems[0].percentage).toBe(30);
    expect(overview.totalBudgeted).toBe(500);
  });

  it("shrinks the cap when earlier months overspent", async () => {
    // Jan–Apr spent 115/month against 100 — May starts 60 in the red.
    await spendEachEarlierMonth(115);

    const overview = await getBudgetOverview(USER, START_DAY, PLAN);

    expect(overview.budgetItems[0]).toMatchObject({
      limit: 40,
      status: "exceeded",
    });
  });

  it("ignores the envelope for a monthly plan", async () => {
    await setPlanPeriod("monthly");

    const overview = await getBudgetOverview(USER, START_DAY, PLAN);

    expect(overview.budgetItems[0]).toMatchObject({
      limit: 100,
      status: "exceeded",
    });
  });

  it("falls back to the plain allocation when the plan has no envelope yet", async () => {
    await db.delete(budgets).where(eq(budgets.userId, USER));
    await db.insert(budgets).values({
      id: "b-late",
      userId: USER,
      budgetId: PLAN,
      categoryId: "c-food",
      amount: 100,
      period: "monthly",
      isActive: true,
      status: "active",
      // Allocated this month, so there is no earlier month to carry from.
      createdAt: `${MONTHS[4].from}T00:00:00.000Z`,
    });

    const overview = await getBudgetOverview(USER, START_DAY, PLAN);

    expect(overview.budgetItems[0]).toMatchObject({
      limit: 100,
      status: "exceeded",
    });
  });
});
