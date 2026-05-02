import { db } from "@/db";
import {
  recurringTransactions,
  transactions,
  budgets,
  categories,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { getFinancialMonthRange } from "@/lib/financial-month";

export interface MonthMoneyMath {
  monthlyIncome: number;
  totalFixedCosts: number;
  reservedTotal: number;
  spentThisMonth: number;
  freeToSpend: number;
  hasIncome: boolean;
  allocations: Map<
    string,
    { amount: number; spent: number; categoryName: string | null }
  >;
}

export function toMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case "weekly":
      return Math.abs(amount) * 4.33;
    case "biweekly":
      return Math.abs(amount) * 2.17;
    case "monthly":
      return Math.abs(amount);
    case "yearly":
      return Math.abs(amount) / 12;
    default:
      return Math.abs(amount);
  }
}

/**
 * Combine ungrouped expense total with the net flow of pot transactions for
 * the same window. Pots only contribute to "spent" when their net is negative
 * (more out than in); a net-positive pot this month adds zero — funding the
 * pot is not the same as spending money.
 */
export function combineMonthSpend(txTotal: number, potNet: number): number {
  return txTotal + Math.abs(Math.min(0, potNet));
}

/**
 * Merge per-category spending from ungrouped transactions and from pots into a
 * single map keyed by categoryId. Each transaction is expected to appear in
 * exactly one of the two inputs (the SQL queries enforce this via
 * `groupId IS NULL` vs `groupId IS NOT NULL`).
 */
export function mergeCategorySpend(
  perCatTx: Array<{ categoryId: string | null; total: number | null }>,
  perCatPot: Array<{ categoryId: string | null; total: number | null }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of perCatTx) {
    if (r.categoryId) out.set(r.categoryId, Number(r.total) || 0);
  }
  for (const r of perCatPot) {
    if (r.categoryId) {
      out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + (Number(r.total) || 0));
    }
  }
  return out;
}

function getCurrentMonthRange(startDay: number = 1): { from: string; to: string } {
  return getFinancialMonthRange(new Date(), startDay);
}

/**
 * Compute the discretionary-remaining math for the current month.
 *
 * `freeToSpend = monthlyIncome − totalFixedCosts − reservedTotal − spentThisMonth`
 *
 * For each reserved-kind category, the contribution to `reservedTotal` is
 * `max(actualThisMonth, monthlyTarget)`:
 *   - With no target set, only actual `type='reserved'` transactions count
 *     (dynamic).
 *   - With a target set, the planned amount is reserved off the top — even
 *     before any transactions land — so Free to Spend reflects the user's
 *     savings commitment up front. Once actuals exceed the target, the
 *     larger amount is used.
 *
 * `spentThisMonth` includes ungrouped expense transactions (excluding
 * internal transfers and reserved transactions) and the net spending from pots
 * whose member transactions fall in this month.
 *
 * The returned `allocations` map lets callers surface per-category warnings
 * (e.g. "this would push Entertainment over budget"). Reserved-kind categories
 * are not included in `allocations`.
 */
export async function getMonthMoneyMath(
  userId: string,
  startDay: number = 1,
): Promise<MonthMoneyMath> {
  const { from, to } = getCurrentMonthRange(startDay);

  const [
    recurringIncome,
    recurringExpenses,
    txExpense,
    potExpense,
    txReserved,
    allBudgets,
  ] = await Promise.all([
    db
      .select({
        amount: recurringTransactions.amount,
        frequency: recurringTransactions.frequency,
      })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.type, "income"),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.userId, userId)
        )
      ),

    db
      .select({
        amount: recurringTransactions.amount,
        frequency: recurringTransactions.frequency,
      })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.type, "expense"),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.userId, userId)
        )
      ),

    db
      .select({
        total: sql<number>`sum(
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl
              JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
              WHERE rl.expense_id = "transactions"."id"),
            0
          )
        )`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`COALESCE(${categories.name}, '') <> 'Internal Transfer'`,
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to)
        )
      ),

    db
      .select({ potNet: sql<number>`SUM(t.amount)` })
      .from(sql`transactions t`)
      .innerJoin(sql`transaction_groups g`, sql`t.group_id = g.id`)
      .where(
        sql`t.group_id IS NOT NULL AND t.type <> 'reserved' AND t.user_id = ${userId} AND t.date >= ${from} AND t.date <= ${to}`
      ),

    db
      .select({
        categoryId: transactions.categoryId,
        total: sql<number>`sum(abs(${transactions.amount}))`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "reserved"),
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to)
        )
      )
      .groupBy(transactions.categoryId),

    db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        categoryKind: categories.kind,
        amount: budgets.amount,
        period: budgets.period,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id))
      .where(and(eq(budgets.userId, userId), eq(budgets.isActive, true), eq(budgets.status, "active"))),
  ]);

  const monthlyIncome = recurringIncome.reduce(
    (s, r) => s + toMonthly(r.amount, r.frequency),
    0
  );
  const totalFixedCosts = recurringExpenses.reduce(
    (s, r) => s + toMonthly(r.amount, r.frequency),
    0
  );

  const txTotal = Number(txExpense[0]?.total) || 0;
  const potNet = Number(potExpense[0]?.potNet) || 0;
  const spentThisMonth = combineMonthSpend(txTotal, potNet);

  // Per-reserved-category math: the contribution is `max(actual, target)`.
  // Without a target, only actual transactions count (dynamic). With a
  // target, the planned amount is reserved up front; if actual exceeds it,
  // the larger amount wins.
  const reservedTargets = new Map<string, number>();
  for (const b of allBudgets) {
    if (b.categoryKind === "reserved") {
      reservedTargets.set(b.categoryId, toMonthly(b.amount, b.period));
    }
  }
  const reservedActuals = new Map<string, number>();
  for (const r of txReserved) {
    if (r.categoryId) reservedActuals.set(r.categoryId, Number(r.total) || 0);
  }
  const reservedCategoryIds = new Set<string>([
    ...reservedTargets.keys(),
    ...reservedActuals.keys(),
  ]);
  let reservedTotal = 0;
  for (const id of reservedCategoryIds) {
    reservedTotal += Math.max(
      reservedActuals.get(id) ?? 0,
      reservedTargets.get(id) ?? 0
    );
  }

  // Reserved-kind categories never participate in the spending-allocation
  // warnings — those are for discretionary categories with a spending limit.
  const spendingBudgets = allBudgets.filter((b) => b.categoryKind !== "reserved");

  // Per-category spending for the budget warning. Pots count toward their
  // category, matching how the budgets page displays things.
  const allocations = new Map<
    string,
    { amount: number; spent: number; categoryName: string | null }
  >();

  if (spendingBudgets.length > 0) {
    const categoryIds = spendingBudgets.map((b) => b.categoryId);

    const [perCatTx, perCatPot] = await Promise.all([
      db
        .select({
          categoryId: transactions.categoryId,
          total: sql<number>`sum(
            abs(${transactions.amount}) - COALESCE(
              (SELECT SUM(r.amount) FROM reimbursement_links rl
                JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
                WHERE rl.expense_id = "transactions"."id"),
              0
            )
          )`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            inArray(transactions.categoryId, categoryIds),
            gte(transactions.date, from),
            lte(transactions.date, to)
          )
        )
        .groupBy(transactions.categoryId),

      db
        .select({
          categoryId: transactionGroups.categoryId,
          total: sql<number>`abs(sum(${transactions.amount}))`,
        })
        .from(transactionGroups)
        .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
        .where(
          and(
            eq(transactionGroups.userId, userId),
            inArray(transactionGroups.categoryId, categoryIds),
            gte(transactions.date, from),
            lte(transactions.date, to)
          )
        )
        .groupBy(transactionGroups.id, transactionGroups.categoryId),
    ]);

    const spentByCat = mergeCategorySpend(perCatTx, perCatPot);

    for (const b of spendingBudgets) {
      allocations.set(b.categoryId, {
        amount: b.amount,
        spent: spentByCat.get(b.categoryId) ?? 0,
        categoryName: b.categoryName,
      });
    }
  }

  const freeToSpend = monthlyIncome - totalFixedCosts - reservedTotal - spentThisMonth;

  return {
    monthlyIncome,
    totalFixedCosts,
    reservedTotal,
    spentThisMonth,
    freeToSpend,
    hasIncome: monthlyIncome > 0,
    allocations,
  };
}
