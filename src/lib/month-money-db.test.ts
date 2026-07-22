import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("month-money");

const { db } = await import("@/db");
const { getMonthMoneyMath, getCurrentMonthRange } = await import("./month-money");
const {
  transactions,
  categories,
  budgets,
  recurringTransactions,
  transactionGroups,
  reimbursementLinks,
} = await import("@/db/schema");

const USER = "user-1";
const { from: TODAY } = getCurrentMonthRange(1); // first day of the current calendar month

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

async function insertCategory() {
  const id = nextId("cat");
  await db.insert(categories).values({ id, userId: USER, name: `Cat ${seq}` });
  return id;
}

async function insertTx(opts: {
  amount: number;
  type: "income" | "expense" | "reimbursement" | "internal_transfer";
  categoryId?: string | null;
  groupId?: string | null;
  recurringTransactionId?: string | null;
  accountId?: string;
  date?: string;
  userId?: string;
}) {
  const id = nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: opts.userId ?? USER,
    accountId: opts.accountId ?? "acct-1",
    date: opts.date ?? TODAY,
    description: "test",
    amount: opts.amount,
    type: opts.type,
    categoryId: opts.categoryId ?? null,
    groupId: opts.groupId ?? null,
    recurringTransactionId: opts.recurringTransactionId ?? null,
  });
  return id;
}

async function insertRecurringExpense(amount: number, frequency = "monthly") {
  const id = nextId("rec");
  await db.insert(recurringTransactions).values({
    id,
    userId: USER,
    accountId: "acct-1",
    description: `Plan ${seq}`,
    amount,
    type: "expense",
    frequency: frequency as "monthly",
    startDate: "2025-01-01",
  });
  return id;
}

async function insertBudget(categoryId: string, amount: number, period = "monthly") {
  const id = nextId("bud");
  await db.insert(budgets).values({
    id,
    userId: USER,
    categoryId,
    amount,
    period: period as "monthly",
  });
  return id;
}

async function insertPot(categoryId: string | null) {
  const id = nextId("pot");
  await db
    .insert(transactionGroups)
    .values({ id, userId: USER, name: `Pot ${seq}`, categoryId });
  return id;
}

describe("getMonthMoneyMath", () => {
  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("returns zeros for a user with no data", async () => {
    const math = await getMonthMoneyMath(USER);
    expect(math.monthlyIncome).toBe(0);
    expect(math.totalFixedCosts).toBe(0);
    expect(math.spentThisMonth).toBe(0);
    expect(math.freeToSpend).toBe(0);
    expect(math.hasIncome).toBe(false);
    expect(math.allocations.size).toBe(0);
  });

  it("computes the full freeToSpend equation across income, fixed, spend and pots", async () => {
    const groceries = await insertCategory();
    await insertBudget(groceries, 300);

    await insertTx({ amount: 3000, type: "income" });

    // Recurring rent planned €1000; the actual bill landed €50 higher.
    const rent = await insertRecurringExpense(1000);
    await insertTx({ amount: -1050, type: "expense", recurringTransactionId: rent });

    // Ungrouped groceries spend plus a net-negative pot in the same category.
    await insertTx({ amount: -150, type: "expense", categoryId: groceries });
    const pot = await insertPot(groceries);
    await insertTx({ amount: -80, type: "expense", categoryId: groceries, groupId: pot });

    const math = await getMonthMoneyMath(USER);
    expect(math.monthlyIncome).toBe(3000);
    expect(math.totalFixedCosts).toBe(1050); // max(planned 1000, actual 1050)
    expect(math.spentThisMonth).toBe(230); // 150 ungrouped + 80 pot net
    expect(math.freeToSpend).toBe(3000 - 1050 - 230);
    expect(math.hasIncome).toBe(true);

    // Allocations: pot spend counts toward its category.
    expect(math.allocations.size).toBe(1);
    expect(math.allocations.get(groceries)).toMatchObject({
      amount: 300,
      spent: 230,
    });
  });

  it("reserves the planned recurring amount when the bill has not landed yet", async () => {
    await insertTx({ amount: 2000, type: "income" });
    await insertRecurringExpense(800);
    const math = await getMonthMoneyMath(USER);
    expect(math.totalFixedCosts).toBe(800);
    expect(math.freeToSpend).toBe(1200);
  });

  it("converts recurring frequencies to monthly amounts", async () => {
    await insertRecurringExpense(100, "weekly"); // 433
    await insertRecurringExpense(1200, "yearly"); // 100
    const math = await getMonthMoneyMath(USER);
    expect(math.totalFixedCosts).toBeCloseTo(100 * 4.33 + 100, 5);
  });

  it("does not double-deduct recurring-linked transactions from spentThisMonth", async () => {
    const rent = await insertRecurringExpense(1000);
    await insertTx({ amount: -1000, type: "expense", recurringTransactionId: rent });
    const math = await getMonthMoneyMath(USER);
    expect(math.totalFixedCosts).toBe(1000);
    expect(math.spentThisMonth).toBe(0);
  });

  it("ignores a net-positive pot — funding a pot is not spending", async () => {
    const pot = await insertPot(null);
    await insertTx({ amount: 100, type: "income", groupId: pot });
    await insertTx({ amount: -30, type: "expense", groupId: pot });
    expect((await getMonthMoneyMath(USER)).spentThisMonth).toBe(0);
  });

  it("subtracts reimbursements from expense totals", async () => {
    const dinner = await insertTx({ amount: -100, type: "expense" });
    const payback = await insertTx({ amount: 40, type: "reimbursement" });
    await db.insert(reimbursementLinks).values({
      id: nextId("rl"),
      reimbursementId: payback,
      expenseId: dinner,
    });
    expect((await getMonthMoneyMath(USER)).spentThisMonth).toBe(60);
  });

  it("splits a reimbursement linked to several expenses instead of double-counting it", async () => {
    const a = await insertTx({ amount: -100, type: "expense" });
    const b = await insertTx({ amount: -100, type: "expense" });
    const payback = await insertTx({ amount: 60, type: "reimbursement" });
    for (const expenseId of [a, b]) {
      await db.insert(reimbursementLinks).values({
        id: nextId("rl"),
        reimbursementId: payback,
        expenseId,
      });
    }
    // €60 split across two expenses: 200 − 60 = 140, not 200 − 120.
    expect((await getMonthMoneyMath(USER)).spentThisMonth).toBe(140);
  });

  it("floors an over-reimbursed expense at zero", async () => {
    const dinner = await insertTx({ amount: -30, type: "expense" });
    const payback = await insertTx({ amount: 50, type: "reimbursement" });
    await db.insert(reimbursementLinks).values({
      id: nextId("rl"),
      reimbursementId: payback,
      expenseId: dinner,
    });
    expect((await getMonthMoneyMath(USER)).spentThisMonth).toBe(0);
  });

  it("excludes transactions outside the current financial month", async () => {
    const lastMonth = new Date(TODAY);
    lastMonth.setDate(lastMonth.getDate() - 5);
    const oldDate = lastMonth.toISOString().slice(0, 10);
    await insertTx({ amount: 5000, type: "income", date: oldDate });
    await insertTx({ amount: -500, type: "expense", date: oldDate });
    const math = await getMonthMoneyMath(USER);
    expect(math.monthlyIncome).toBe(0);
    expect(math.spentThisMonth).toBe(0);
  });

  it("scopes transaction-derived numbers to accountIds but keeps fixed costs global", async () => {
    await insertTx({ amount: 3000, type: "income", accountId: "acct-1" });
    await insertTx({ amount: 999, type: "income", accountId: "acct-2" });
    await insertTx({ amount: -100, type: "expense", accountId: "acct-2" });
    await insertRecurringExpense(500);

    const math = await getMonthMoneyMath(USER, 1, { accountIds: ["acct-1"] });
    expect(math.monthlyIncome).toBe(3000);
    expect(math.spentThisMonth).toBe(0);
    expect(math.totalFixedCosts).toBe(500);
  });

  it("ignores other users' data entirely", async () => {
    await insertTx({ amount: 4000, type: "income", userId: "user-2" });
    await insertTx({ amount: -400, type: "expense", userId: "user-2" });
    const math = await getMonthMoneyMath(USER);
    expect(math.monthlyIncome).toBe(0);
    expect(math.spentThisMonth).toBe(0);
  });

  it("excludes inactive and suggested budgets from allocations", async () => {
    const groceries = await insertCategory();
    const idle = nextId("bud");
    await db.insert(budgets).values({
      id: idle,
      userId: USER,
      categoryId: groceries,
      amount: 300,
      period: "monthly",
      status: "suggested",
    });
    expect((await getMonthMoneyMath(USER)).allocations.size).toBe(0);
  });
});
