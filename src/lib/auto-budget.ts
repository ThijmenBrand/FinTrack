import { db } from "@/db";
import {
  budgets,
  categories,
  recurringTransactions,
  transactions,
} from "@/db/schema";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { BudgetSuggestion } from "@/types/api";
import { effectiveExpenseAmount } from "@/lib/reimbursement-sql";
import { excludeSplitParents } from "@/lib/split-sql";
import { clampFrom, getStatsCutoff } from "@/lib/stat-reset";
import { toIsoDate } from "@/lib/utils";
import type { ResolvedBudgetPlan } from "@/lib/budget-plan";

/**
 * Round a number up to the nearest multiple of 5 (e.g. 142.30 -> 145).
 * Returns 0 unchanged.
 */
export function roundUpToFive(value: number): number {
  if (value <= 0) return 0;
  return Math.ceil(value / 5) * 5;
}

interface DateWindow {
  from: string;
  to: string;
  monthCount: number;
}

/**
 * Compute the inclusive date window covering the last `lookbackMonths` complete
 * months prior to today (today's month is excluded).
 */
function getLookbackWindow(lookbackMonths: number): DateWindow {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - lookbackMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  // `toIsoDate`, not `toISOString()`: these Dates are built in local time, and
  // rendering them as UTC slides the window a day west of Greenwich — which
  // drops the last day of the newest complete month out of the average.
  return {
    from: toIsoDate(start),
    to: toIsoDate(end),
    monthCount: lookbackMonths,
  };
}

/**
 * Build a fresh set of budget suggestions for a user based on historical
 * spending, replacing any prior pending suggestions. Categories already
 * covered by recurring fixed costs are skipped, as are pot/grouped
 * transactions and reimbursed amounts. Income-only categories naturally drop
 * out because they have no expense transactions.
 *
 * Returns the list of suggestions that were persisted with status='suggested'.
 */
export async function regenerateBudgetSuggestions(
  userId: string,
  lookbackMonths: number,
  plan?: ResolvedBudgetPlan | null,
): Promise<BudgetSuggestion[]> {
  if (lookbackMonths < 1 || lookbackMonths > 12) {
    throw new Error(
      `regenerateBudgetSuggestions: lookbackMonths must be 1..12, got ${lookbackMonths}`,
    );
  }
  // Per-plan scoping: spending history and fixed costs count only the plan's
  // accounts, and the produced suggestions belong to the plan. A plan with no
  // accounts has no history and gets no suggestions.
  const planFilter = plan ? eq(budgets.budgetId, plan.id) : isNull(budgets.budgetId);
  const txScope = plan
    ? plan.accountIds.length > 0
      ? inArray(transactions.accountId, plan.accountIds)
      : sql`1=0`
    : undefined;
  const recurringScope = plan
    ? plan.accountIds.length > 0
      ? inArray(recurringTransactions.accountId, plan.accountIds)
      : sql`1=0`
    : undefined;
  const window = getLookbackWindow(lookbackMonths);
  // A statistics reset means older spending no longer describes this user, so
  // the lookback never reaches past it. monthsCovered is counted from the rows
  // that survive, so a short post-reset history yields a short-history average
  // rather than one diluted by months of zeros.
  const from = clampFrom(window.from, await getStatsCutoff(userId))!;

  // Categories that already have recurring expenses are treated as fixed costs
  // and excluded from auto-budgets.
  const fixedCostRows = await db
    .select({ categoryId: recurringTransactions.categoryId })
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.type, "expense"),
        eq(recurringTransactions.isActive, true),
        ...(recurringScope ? [recurringScope] : []),
      ),
    );
  const fixedCategoryIds = new Set(
    fixedCostRows.map((r) => r.categoryId).filter((id): id is string => !!id),
  );

  // Total expense per category over the lookback window, with reimbursements
  // subtracted and pot transactions excluded (mirroring the budget page logic).
  const spendRows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      total: sql<number>`sum(${effectiveExpenseAmount()})`,
      monthsCovered: sql<number>`count(distinct substr(${transactions.date}, 1, 7))`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        sql`${transactions.groupId} IS NULL`,
        sql`${transactions.categoryId} IS NOT NULL`,
        excludeSplitParents(),
        gte(transactions.date, from),
        lte(transactions.date, window.to),
        ...(txScope ? [txScope] : []),
      ),
    )
    .groupBy(transactions.categoryId);

  // Existing active budgets for comparison (so the UI can show current vs. suggested).
  const activeBudgetRows = await db
    .select({ id: budgets.id, categoryId: budgets.categoryId, amount: budgets.amount })
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        eq(budgets.isActive, true),
        eq(budgets.status, "active"),
        planFilter,
      ),
    );
  const activeByCategory = new Map<string, { id: string; amount: number }>();
  for (const row of activeBudgetRows) {
    activeByCategory.set(row.categoryId, { id: row.id, amount: row.amount });
  }

  // Drop any existing pending suggestions before creating fresh ones — a
  // regeneration always reflects the latest spending pattern.
  await db
    .delete(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.status, "suggested"), planFilter));

  const now = new Date().toISOString();
  const suggestions: BudgetSuggestion[] = [];

  for (const row of spendRows) {
    if (!row.categoryId) continue;
    if (fixedCategoryIds.has(row.categoryId)) continue;

    const totalSpent = row.total ?? 0;
    const monthsObserved = row.monthsCovered ?? 0;
    if (totalSpent <= 0 || monthsObserved <= 0) continue;

    const avg = totalSpent / monthsObserved;
    const suggestedAmount = roundUpToFive(avg);
    if (suggestedAmount <= 0) continue;

    const existing = activeByCategory.get(row.categoryId);
    // Skip categories where the active budget already matches the suggestion —
    // there is nothing to propose.
    if (existing && existing.amount === suggestedAmount) continue;

    const id = crypto.randomUUID();
    await db.insert(budgets).values({
      id,
      userId,
      budgetId: plan?.id ?? null,
      categoryId: row.categoryId,
      amount: suggestedAmount,
      period: "monthly",
      isActive: false,
      status: "suggested",
      source: "auto",
      generatedAt: now,
      createdAt: now,
    });

    suggestions.push({
      id,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryColor: row.categoryColor,
      suggestedAmount,
      currentAmount: existing?.amount ?? null,
      avgMonthly: Math.round(avg * 100) / 100,
      monthsOfData: monthsObserved,
      generatedAt: now,
    });
  }

  return suggestions;
}

/** Why a generate run produced nothing. */
export type EmptyGenerateReason = "no-accounts" | "no-history" | "up-to-date";

/**
 * Explain an empty suggestion run so the UI can tell the user what to fix.
 * Only called when `regenerateBudgetSuggestions` returned nothing, so the one
 * extra query costs nothing on the happy path.
 */
export async function explainEmptyGenerate(
  userId: string,
  lookbackMonths: number,
  plan?: ResolvedBudgetPlan | null,
): Promise<EmptyGenerateReason> {
  if (plan && plan.accountIds.length === 0) return "no-accounts";

  const window = getLookbackWindow(lookbackMonths);
  const from = clampFrom(window.from, await getStatsCutoff(userId))!;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        sql`${transactions.groupId} IS NULL`,
        sql`${transactions.categoryId} IS NOT NULL`,
        excludeSplitParents(),
        gte(transactions.date, from),
        lte(transactions.date, window.to),
        ...(plan ? [inArray(transactions.accountId, plan.accountIds)] : []),
      ),
    );
  return (row?.count ?? 0) > 0 ? "up-to-date" : "no-history";
}

/**
 * Determine whether a regeneration prompt should be shown based on how long
 * ago the last check was relative to the configured cadence (in months).
 */
export function isRegenerationDue(
  lastCheckAt: string | null,
  intervalMonths: number,
): boolean {
  if (!lastCheckAt) return true;
  const last = new Date(lastCheckAt);
  if (Number.isNaN(last.getTime())) return true;
  const due = new Date(last);
  due.setMonth(due.getMonth() + Math.max(1, intervalMonths));
  return new Date() >= due;
}
