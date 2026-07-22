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
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";

export interface MonthMoneyMath {
  monthlyIncome: number;
  totalFixedCosts: number;
  spentThisMonth: number;
  freeToSpend: number;
  hasIncome: boolean;
  allocations: Map<
    string,
    { amount: number; spent: number; categoryName: string | null }
  >;
}

export interface MonthMoneyOptions {
  /**
   * Restrict transaction-derived numbers (income, spent) to
   * these accounts. Typically `[defaultAccountId, ...accountsFundedByTransfersFromDefault]`
   * so cross-account spending funded by the default account still counts.
   * Omit / pass undefined to span all of the user's accounts.
   */
  accountIds?: string[];
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

export function getCurrentMonthRange(startDay: number = 1): { from: string; to: string } {
  return getFinancialMonthRange(new Date(), startDay);
}

/**
 * Compute the discretionary-remaining math for the current month.
 *
 * `freeToSpend = monthlyIncome − totalFixedCosts − spentThisMonth`
 *
 * `monthlyIncome` is the sum of actual income transactions in the period —
 * not the recurring-income plan — so the math reflects what actually came in.
 *
 * For each recurring-expense plan, the contribution to `totalFixedCosts` is
 * `max(actualThisMonth, plannedMonthly)`:
 *   - Plans with no actual transactions yet still reserve the planned amount
 *     up front (early-month case stays correct).
 *   - When a bill lands higher than planned (variable utility, etc.), the
 *     overage is reflected — Free to Spend doesn't overstate by the gap.
 *   - Linked transactions are still excluded from `spentThisMonth` (below) so
 *     we don't triple-deduct.
 *
 * `spentThisMonth` includes ungrouped expense transactions (excluding
 * internal transfers and transactions linked to a
 * recurring plan) plus the net spending from pots whose member transactions
 * fall in this month. Recurring-linked transactions are excluded because the
 * planned monthly amount already lives in `totalFixedCosts` — counting both
 * would double-deduct.
 *
 * When `options.accountIds` is provided, transaction-derived numbers (income,
 * spent) are scoped to those accounts. Recurring fixed costs
 * stay account-agnostic since they aren't tied to a specific account.
 *
 * The returned `allocations` map lets callers surface per-category warnings
 * (e.g. "this would push Entertainment over budget").
 */
export async function getMonthMoneyMath(
  userId: string,
  startDay: number = 1,
  options: MonthMoneyOptions = {},
): Promise<MonthMoneyMath> {
  const { from, to } = getCurrentMonthRange(startDay);
  const { accountIds } = options;
  const hasAccountFilter = accountIds && accountIds.length > 0;
  const accountFilter = hasAccountFilter
    ? inArray(transactions.accountId, accountIds!)
    : sql`1=1`;
  const accountFilterAlias = hasAccountFilter
    ? sql` AND t.account_id IN (${sql.join(
        accountIds!.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;

  const [
    txIncome,
    recurringExpenses,
    actualRecurring,
    txExpense,
    potExpense,
    allBudgets,
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "income"),
          gte(transactions.date, from),
          lte(transactions.date, to),
          accountFilter,
        )
      ),

    db
      .select({
        id: recurringTransactions.id,
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

    // Actual recurring spend per plan in the period. Used to bump
    // `totalFixedCosts` via max(planned, actual) so an over-plan bill shows up
    // in Free to Spend. Account-agnostic to match the planned-cost query.
    db
      .select({
        recurringTransactionId: transactions.recurringTransactionId,
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.recurringTransactionId} IS NOT NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to),
        )
      )
      .groupBy(transactions.recurringTransactionId),

    db
      .select({
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          // Exclude transactions tied to a recurring plan — those are already
          // accounted for via `totalFixedCosts`. Counting both sides would
          // double-deduct from Free to Spend once the bill clears.
          sql`${transactions.recurringTransactionId} IS NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to),
          accountFilter,
        )
      ),

    db
      .select({ potNet: sql<number>`SUM(t.amount)` })
      .from(sql`transactions t`)
      .innerJoin(sql`transaction_groups g`, sql`t.group_id = g.id`)
      .where(
        sql`t.group_id IS NOT NULL AND t.type != 'internal_transfer' AND t.user_id = ${userId} AND t.date >= ${from} AND t.date <= ${to}${accountFilterAlias}`
      ),

    db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        amount: budgets.amount,
        period: budgets.period,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id))
      .where(and(eq(budgets.userId, userId), eq(budgets.isActive, true), eq(budgets.status, "active"))),
  ]);

  const monthlyIncome = Number(txIncome[0]?.total) || 0;
  const actualByPlan = new Map<string, number>();
  for (const r of actualRecurring) {
    if (r.recurringTransactionId) {
      actualByPlan.set(r.recurringTransactionId, Number(r.total) || 0);
    }
  }
  const totalFixedCosts = recurringExpenses.reduce((s, r) => {
    const planned = toMonthly(r.amount, r.frequency);
    const actual = actualByPlan.get(r.id) ?? 0;
    return s + Math.max(planned, actual);
  }, 0);

  const txTotal = Number(txExpense[0]?.total) || 0;
  const potNet = Number(potExpense[0]?.potNet) || 0;
  const spentThisMonth = combineMonthSpend(txTotal, potNet);

  // Per-category spending for the budget warning. Pots count toward their
  // category, matching how the budgets page displays things.
  const allocations = new Map<
    string,
    { amount: number; spent: number; categoryName: string | null }
  >();

  if (allBudgets.length > 0) {
    const categoryIds = allBudgets.map((b) => b.categoryId);

    const [perCatTx, perCatPot] = await Promise.all([
      db
        .select({
          categoryId: transactions.categoryId,
          total: sql<number>`sum(${effectiveExpenseAmount()})`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            inArray(transactions.categoryId, categoryIds),
            gte(transactions.date, from),
            lte(transactions.date, to),
            accountFilter,
          )
        )
        .groupBy(transactions.categoryId),

      db
        .select({
          categoryId: transactionGroups.categoryId,
          total: sql<number>`${potSpentAmount()}`,
        })
        .from(transactionGroups)
        .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
        .where(
          and(
            eq(transactionGroups.userId, userId),
            inArray(transactionGroups.categoryId, categoryIds),
            sql`${transactions.type} != 'internal_transfer'`,
            gte(transactions.date, from),
            lte(transactions.date, to),
            accountFilter,
          )
        )
        .groupBy(transactionGroups.id, transactionGroups.categoryId),
    ]);

    const spentByCat = mergeCategorySpend(perCatTx, perCatPot);

    for (const b of allBudgets) {
      allocations.set(b.categoryId, {
        amount: b.amount,
        spent: spentByCat.get(b.categoryId) ?? 0,
        categoryName: b.categoryName,
      });
    }
  }

  const freeToSpend = monthlyIncome - totalFixedCosts - spentThisMonth;

  return {
    monthlyIncome,
    totalFixedCosts,
    spentThisMonth,
    freeToSpend,
    hasIncome: monthlyIncome > 0,
    allocations,
  };
}
