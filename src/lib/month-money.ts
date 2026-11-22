import { cache } from "react";
import { db } from "@/db";
import {
  recurringTransactions,
  transactions,
  budgets,
  categories,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, or, sql, inArray } from "drizzle-orm";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { memberAccountIds, visibleTransactions } from "@/lib/account-access";
import { toMonthly } from "@/lib/recurring";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { excludeSplitParents } from "@/lib/split-sql";

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

export { toMonthly };

/**
 * Recurring plans the user may see: their own, plus plans on accounts actively
 * shared with them (those rows carry the OWNER's user_id, so a plain match
 * misses them — the same reason `visibleTransactions` exists).
 */
function visibleRecurring(userId: string) {
  return or(
    eq(recurringTransactions.userId, userId),
    inArray(recurringTransactions.accountId, memberAccountIds(userId)),
  )!;
}

/** Pots the user may see: their own, plus pots holding shared-account rows. */
function visiblePots(userId: string) {
  return or(
    eq(transactionGroups.userId, userId),
    inArray(transactions.accountId, memberAccountIds(userId)),
  )!;
}

/**
 * The account scope as one string, because `cache` matches arguments by
 * identity and each caller builds its own array.
 *
 * `null` — and only `null` — means "every account". An empty list means that
 * too, matching what the callers did before; but a list of real ids always
 * produces a non-null key, so a scope can never widen itself by accident.
 */
function scopeKeyOf(accountIds: string[] | undefined): string | null {
  return accountIds && accountIds.length > 0 ? accountIds.join(",") : null;
}

function scopeFilterOf(scopeKey: string | null) {
  return scopeKey === null
    ? sql`1=1`
    : inArray(transactions.accountId, scopeKey.split(","));
}

/**
 * Money that arrived this month, outside any pot.
 *
 * Two dashboard cards want this exact number — the period tiles through
 * {@link getMonthSummary}, Free to Spend through {@link getMonthMoneyMath} —
 * and they were each asking the database for it. Read once per render pass
 * and shared; a card with a genuinely different scope still gets its own.
 */
export function monthIncomeTotal(
  userId: string,
  from: string,
  to: string,
  accountIds: string[] | undefined,
): Promise<number> {
  return loadMonthIncomeTotal(userId, from, to, scopeKeyOf(accountIds));
}

const loadMonthIncomeTotal = cache(
  async (userId: string, from: string, to: string, scopeKey: string | null): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`sum(${transactions.amount})` })
      .from(transactions)
      .where(
        and(
          visibleTransactions(userId),
          eq(transactions.type, "income"),
          // Grouped rows are netted into the pot spend below; counting them as
          // income too would credit a pot's refund twice.
          sql`${transactions.groupId} IS NULL`,
          excludeSplitParents(),
          gte(transactions.date, from),
          lte(transactions.date, to),
          scopeFilterOf(scopeKey),
        ),
      );
    return Number(rows[0]?.total) || 0;
  },
);

/**
 * What the pots spent this month, netted PER POT and floored at zero, then
 * added up — so a deposit into one pot can't cancel another's spending.
 * Shared between the same two cards as {@link monthIncomeTotal}.
 */
export function monthPotSpendTotal(
  userId: string,
  from: string,
  to: string,
  accountIds: string[] | undefined,
): Promise<number> {
  return loadMonthPotSpendTotal(userId, from, to, scopeKeyOf(accountIds));
}

const loadMonthPotSpendTotal = cache(
  async (userId: string, from: string, to: string, scopeKey: string | null): Promise<number> => {
    const rows = await db
      .select({ spent: sql<number>`${potSpentAmount()}` })
      .from(transactionGroups)
      .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
      .where(
        and(
          visiblePots(userId),
          sql`${transactions.type} != 'internal_transfer'`,
          excludeSplitParents(),
          gte(transactions.date, from),
          lte(transactions.date, to),
          scopeFilterOf(scopeKey),
        ),
      )
      .groupBy(transactionGroups.id);
    return rows.reduce((s, r) => s + (Number(r.spent) || 0), 0);
  },
);

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
 * Scope is every account the user may READ — own plus actively shared — which
 * is the scope the dashboard hands in (`defaultScopeAccountIds` runs over
 * `visibleAccounts`) and the scope `getMonthSummary`'s Earned/Spent tiles
 * already use. A plain `user_id` match missed rows on shared accounts, which
 * keep the OWNER's user_id, so the same card reported joint spending in one
 * tile and left it out of Free to Spend.
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

  // The income and pot-spend reads are shared with getMonthSummary, which the
  // tiles above Free to Spend run off; they stay inside this wave, so a cache
  // miss costs no extra trip and a hit costs nothing at all.
  const [
    monthlyIncome,
    recurringExpenses,
    actualRecurring,
    txExpense,
    potSpent,
    allBudgets,
  ] = await Promise.all([
    monthIncomeTotal(userId, from, to, accountIds),

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
          visibleRecurring(userId),
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
          visibleTransactions(userId),
          eq(transactions.type, "expense"),
          sql`${transactions.recurringTransactionId} IS NOT NULL`,
          // Children inherit the parent's recurring link, so a split bill would
          // be counted once as the wrapper and again as its parts.
          excludeSplitParents(),
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
          visibleTransactions(userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          // Exclude transactions tied to a recurring plan — those are already
          // accounted for via `totalFixedCosts`. Counting both sides would
          // double-deduct from Free to Spend once the bill clears.
          sql`${transactions.recurringTransactionId} IS NULL`,
          excludeSplitParents(),
          gte(transactions.date, from),
          lte(transactions.date, to),
          accountFilter,
        )
      ),

    monthPotSpendTotal(userId, from, to, accountIds),

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
  const spentThisMonth = txTotal + potSpent;

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
            visibleTransactions(userId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            inArray(transactions.categoryId, categoryIds),
            excludeSplitParents(),
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
            visiblePots(userId),
            inArray(transactionGroups.categoryId, categoryIds),
            sql`${transactions.type} != 'internal_transfer'`,
            excludeSplitParents(),
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
