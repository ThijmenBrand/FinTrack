import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("dashboard-budget");

const { getBudgetOverview } = await import("@/app/(app)/_lib/dashboard-queries");
const { db } = await import("@/db");
const {
  transactions,
  transactionGroups,
  categories,
  budgets,
  recurringTransactions,
} = await import(
  "@/db/schema"
);

const USER = "user-1";
const TODAY = new Date().toISOString().slice(0, 10);
let seq = 0;

async function expense(
  amount: number,
  opts: { categoryId?: string; groupId?: string } = {},
) {
  await db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: USER,
    accountId: "acct-1",
    date: TODAY,
    description: "t",
    amount,
    type: "expense",
    ...opts,
  });
}

beforeEach(async () => {
  await testDb.reset();
  await db.insert(categories).values([
    { id: "c-holiday", userId: USER, name: "Holiday" },
    { id: "c-drinks", userId: USER, name: "Drinks" },
  ]);
  await db.insert(transactionGroups).values([
    { id: "p-trip", userId: USER, name: "Trip", categoryId: "c-holiday" },
    { id: "p-drinks", userId: USER, name: "Rounds", categoryId: "c-drinks" },
    { id: "p-loose", userId: USER, name: "Loose", categoryId: null },
  ]);
});
afterAll(() => testDb.cleanup());

describe("getBudgetOverview — pot spending follows the pot's category", () => {
  it("counts a categorised pot toward that category's budget bar", async () => {
    await db.insert(budgets).values({
      id: "b-holiday",
      userId: USER,
      categoryId: "c-holiday",
      amount: 1000,
      period: "monthly",
    });
    await expense(-300, { groupId: "p-trip" });
    await expense(-40, { categoryId: "c-holiday" });

    const r = await getBudgetOverview(USER, 1);

    expect(r.budgetItems).toEqual([
      expect.objectContaining({ categoryId: "c-holiday", spent: 340 }),
    ]);
    // No "Into pots" row — the pot's spend lives in the bar above.
    expect(r.unbudgetedItems).toEqual([]);
    expect(r.totalBudgetSpent).toBe(340);
  });

  it("merges an unbudgeted pot into its category's Not-budgeted row", async () => {
    await expense(-500, { groupId: "p-drinks" });
    await expense(-101, { categoryId: "c-drinks" });

    const r = await getBudgetOverview(USER, 1);

    expect(r.unbudgetedItems.map((i) => [i.categoryName, i.spent])).toEqual([
      ["Drinks", 601],
    ]);
  });

  it("does not mark a recurring-expense category as unbudgeted", async () => {
    await db.insert(categories).values({
      id: "c-rent",
      userId: USER,
      name: "Rent",
    });
    await db.insert(recurringTransactions).values({
      id: "r-rent",
      userId: USER,
      accountId: "acct-1",
      description: "Rent",
      amount: -1000,
      type: "expense",
      categoryId: "c-rent",
      frequency: "monthly",
      startDate: "2025-01-01",
    });
    await expense(-1000, { categoryId: "c-rent" });

    const r = await getBudgetOverview(USER, 1);

    // Fixed costs are the budget for recurring-expense categories. They are
    // listed separately on the Budgets page and therefore aren't eligible for
    // a second manual allocation.
    expect(r.unbudgetedItems).toEqual([]);
    expect(r.totalBudgeted).toBe(1000);
  });

  it("keeps pots without a category in an Into-pots bucket", async () => {
    await expense(-120, { groupId: "p-loose" });
    await expense(-50);

    const r = await getBudgetOverview(USER, 1);

    expect(r.unbudgetedItems.map((i) => [i.categoryName, i.spent])).toEqual([
      ["Into pots", 120],
      [null, 50],
    ]);
    expect(r.totalBudgetSpent).toBe(170);
  });
});
