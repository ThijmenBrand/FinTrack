/**
 * Split transactions must be counted once, on the right side of the fence:
 * spend/income/category aggregates read the children, ledger/balance
 * aggregates read the parent. These tests drive the real exported queries.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("split-totals");

const { db } = await import("@/db");
const { accounts, budgets, categories, transactions } = await import("@/db/schema");
const { getCurrentMonthRange, getMonthMoneyMath } = await import("@/lib/month-money");
const { getYearSpendByCategoryMonth } = await import("@/lib/budget-ledger-db");
const { getAccountBalances } = await import("@/app/(app)/_lib/dashboard-queries");

const USER = "user-1";
const ACCOUNT = "acct-1";
const GROCERIES = "cat-groceries";
const FUN = "cat-fun";
const NOW = "2026-01-01T00:00:00.000Z";

// Anchored to the running financial month so getMonthMoneyMath (which always
// looks at "now") sees the seeded rows.
const { from: DATE } = getCurrentMonthRange(1);
const YEAR = Number(DATE.slice(0, 4));
const MONTH_INDEX = Number(DATE.slice(5, 7)) - 1;

let seq = 0;

async function expense(opts: {
  amount: number;
  categoryId?: string | null;
  isSplitParent?: boolean;
  parentTransactionId?: string | null;
}) {
  const id = `tx-${++seq}`;
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: ACCOUNT,
    date: DATE,
    description: "shop",
    amount: opts.amount,
    type: "expense",
    categoryId: opts.categoryId ?? null,
    isSplitParent: opts.isSplitParent ?? false,
    parentTransactionId: opts.parentTransactionId ?? null,
    createdAt: NOW,
  });
  return id;
}

/** One €100 shop split into €60 groceries + €40 fun, plus a plain €25 shop. */
async function seedSplit() {
  const parent = await expense({ amount: -100, isSplitParent: true });
  await expense({ amount: -60, categoryId: GROCERIES, parentTransactionId: parent });
  await expense({ amount: -40, categoryId: FUN, parentTransactionId: parent });
  await expense({ amount: -25, categoryId: GROCERIES });
  return parent;
}

beforeEach(async () => {
  await testDb.reset();
  await db.insert(accounts).values({
    id: ACCOUNT,
    userId: USER,
    name: "Checking",
    type: "checking",
    initialBalance: 1000,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(categories).values([
    { id: GROCERIES, userId: USER, name: "Groceries", createdAt: NOW },
    { id: FUN, userId: USER, name: "Fun", createdAt: NOW },
  ]);
});

afterAll(() => testDb.cleanup());

describe("split exclusions in aggregates", () => {
  it("counts the children, not the wrapper, in this month's spending", async () => {
    await seedSplit();
    await db.insert(budgets).values({
      id: "budget-1",
      userId: USER,
      categoryId: GROCERIES,
      amount: 500,
      period: "monthly",
      createdAt: NOW,
    });

    const math = await getMonthMoneyMath(USER, 1);

    // 60 + 40 + 25 — the €100 parent would make it 225.
    expect(math.spentThisMonth).toBe(125);
    expect(math.allocations.get(GROCERIES)?.spent).toBe(85);
  });

  it("counts the wrapper, not the children, in the account balance", async () => {
    await seedSplit();

    const [account] = await getAccountBalances(USER);

    // 1000 − 100 − 25. Counting the children too would read 775.
    expect(account.currentBalance).toBe(875);
  });

  it("attributes a split child's amount to its own category", async () => {
    await seedSplit();

    const spend = await getYearSpendByCategoryMonth(USER, YEAR, 1, undefined);

    expect(spend.get(GROCERIES)?.get(MONTH_INDEX)).toBe(85);
    expect(spend.get(FUN)?.get(MONTH_INDEX)).toBe(40);
  });

  it("puts the parent's money back once the split is undone", async () => {
    const parent = await seedSplit();
    // Tenant guard: every write on a tenant table carries user_id.
    await testDb.client.execute({
      sql: "DELETE FROM transactions WHERE parent_transaction_id = ? AND user_id = ?",
      args: [parent, USER],
    });
    await testDb.client.execute({
      sql: "UPDATE transactions SET is_split_parent = 0 WHERE id = ? AND user_id = ?",
      args: [parent, USER],
    });

    const math = await getMonthMoneyMath(USER, 1);
    const [account] = await getAccountBalances(USER);

    expect(math.spentThisMonth).toBe(125);
    expect(account.currentBalance).toBe(875);
  });
});
