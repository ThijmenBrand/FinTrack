/**
 * Building a yearly budget's carry-over chain out of the database.
 *
 * The chain is derived on read, not materialised: a year of spending is two
 * grouped queries and the cascade itself is a twelve-step loop per category,
 * so computing it costs less than keeping a copy correct would. The one thing
 * that genuinely cannot be recomputed — what a month's target *was* when it
 * closed — is frozen into `budget_month_targets` the first time we notice the
 * month has ended, and read back from there forever after.
 */

import { db } from "@/db";
import {
  budgetMonthTargets,
  budgets,
  transactionGroups,
  transactions,
} from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { financialMonthBucketExpr, parseBucket } from "@/lib/financial-bucket";
import { accountScopeFilter, type ResolvedBudgetPlan } from "@/lib/budget-plan";
import {
  closedMonthCount,
  financialSlotOf,
  getFinancialYearMonths,
  getFinancialYearRange,
  MONTHS_PER_YEAR,
} from "@/lib/financial-year";
import { buildYear, type LedgerMonth } from "@/lib/budget-ledger";

export type SpendByCategoryMonth = Map<string, Map<number, number>>;

function addSpend(
  target: SpendByCategoryMonth,
  categoryId: string,
  monthIndex: number,
  amount: number,
) {
  const byMonth = target.get(categoryId) ?? new Map<number, number>();
  byMonth.set(monthIndex, (byMonth.get(monthIndex) ?? 0) + amount);
  target.set(categoryId, byMonth);
}

/**
 * Every euro the plan spent in `year`, split by category and financial month.
 *
 * Matches the spend definition the rest of the budget views use: expense rows
 * outside a pot with reimbursements netted off, plus each pot's own net spend
 * counted against the pot's category. Internal transfers never count.
 */
export async function getYearSpendByCategoryMonth(
  userId: string,
  year: number,
  startDay: number,
  accountIds: string[] | undefined,
): Promise<SpendByCategoryMonth> {
  const { from, to } = getFinancialYearRange(year, startDay);
  const scope = accountScopeFilter(accountIds);
  const bucket = financialMonthBucketExpr(startDay);

  const [txRows, potRows] = await Promise.all([
    db
      .select({
        categoryId: transactions.categoryId,
        bucket: sql<string>`${bucket}`,
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          sql`${transactions.categoryId} IS NOT NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to),
          ...(scope ? [scope] : []),
        ),
      )
      .groupBy(transactions.categoryId, sql`${bucket}`),

    // Pots net per pot per month — the floor-at-zero in potSpentAmount has to
    // apply to a whole month, so the bucket is part of the GROUP BY rather
    // than something we could sort out afterwards in JS.
    db
      .select({
        categoryId: transactionGroups.categoryId,
        bucket: sql<string>`${bucket}`,
        total: sql<number>`${potSpentAmount()}`,
      })
      .from(transactionGroups)
      .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
      .where(
        and(
          eq(transactionGroups.userId, userId),
          sql`${transactionGroups.categoryId} IS NOT NULL`,
          sql`${transactions.type} != 'internal_transfer'`,
          gte(transactions.date, from),
          lte(transactions.date, to),
          ...(scope ? [scope] : []),
        ),
      )
      .groupBy(transactionGroups.id, transactionGroups.categoryId, sql`${bucket}`),
  ]);

  const out: SpendByCategoryMonth = new Map();
  for (const row of [...txRows, ...potRows]) {
    if (!row.categoryId || !row.bucket) continue;
    const slot = parseBucket(row.bucket);
    if (slot.year !== year) continue;
    addSpend(out, row.categoryId, slot.monthIndex, Number(row.total) || 0);
  }
  return out;
}

/**
 * The first month of `year` a plan's envelope covers. A plan switched to
 * yearly in July starts there — backfilling carry-over from a January the user
 * never budgeted would invent history.
 */
export function planStartMonthIndex(
  periodStartedAt: string | null,
  year: number,
  startDay: number,
): number {
  if (!periodStartedAt) return 0;
  const slot = financialSlotOf(periodStartedAt, startDay);
  if (slot.year < year) return 0;
  if (slot.year > year) return MONTHS_PER_YEAR;
  return slot.monthIndex;
}

/** Targets already frozen for this plan-year, keyed category → month. */
async function readFrozenTargets(
  userId: string,
  planId: string,
  year: number,
): Promise<Map<string, Map<number, number>>> {
  const rows = await db
    .select({
      categoryId: budgetMonthTargets.categoryId,
      monthIndex: budgetMonthTargets.monthIndex,
      target: budgetMonthTargets.target,
    })
    .from(budgetMonthTargets)
    .where(
      and(
        eq(budgetMonthTargets.userId, userId),
        eq(budgetMonthTargets.budgetId, planId),
        eq(budgetMonthTargets.year, year),
      ),
    );

  const out = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const byMonth = out.get(row.categoryId) ?? new Map<number, number>();
    byMonth.set(row.monthIndex, row.target);
    out.set(row.categoryId, byMonth);
  }
  return out;
}

export interface CategoryLedger {
  categoryId: string;
  months: LedgerMonth[];
}

/**
 * The whole carry-over chain for one plan-year, per category.
 *
 * Closed months that have never been frozen are frozen here, as a side effect
 * of the first read after they end. That write is `onConflictDoNothing`, so
 * concurrent readers settle on one value and a frozen target is never revised.
 *
 * `freeze: false` reads the chain without recording anything — for callers on a
 * render path, where a write is a surprise, and for background reads of a year
 * the user did not ask to see.
 *
 * ponytail: freezing on read means a month that closed while nobody looked
 * freezes at whatever the allocation says on the first later visit, not at its
 * value on the closing day. Any read of the year can be that visit — including
 * one the user did not initiate, such as the previous-year fetch the insights
 * chart makes. Recording allocation edits in their own history table is the
 * upgrade path if that ever matters.
 */
export async function buildLedgerYear(
  userId: string,
  plan: ResolvedBudgetPlan,
  year: number,
  startDay: number,
  now: Date = new Date(),
  freeze: boolean = true,
): Promise<CategoryLedger[]> {
  const [allocations, frozen, spend] = await Promise.all([
    db
      .select({
        categoryId: budgets.categoryId,
        amount: budgets.amount,
        createdAt: budgets.createdAt,
      })
      .from(budgets)
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.budgetId, plan.id),
          eq(budgets.status, "active"),
          eq(budgets.isActive, true),
        ),
      ),
    readFrozenTargets(userId, plan.id, year),
    getYearSpendByCategoryMonth(userId, year, startDay, plan.accountIds),
  ]);

  const slots = getFinancialYearMonths(year, startDay);
  const closedThrough = closedMonthCount(year, startDay, now);
  const planStart = planStartMonthIndex(plan.periodStartedAt, year, startDay);

  const ledger = allocations.map((alloc) => {
    // A category joins the envelope when it was allocated, never earlier.
    const created = financialSlotOf(alloc.createdAt.slice(0, 10), startDay);
    const allocStart =
      created.year < year
        ? 0
        : created.year > year
          ? MONTHS_PER_YEAR
          : created.monthIndex;
    const startMonthIndex = Math.max(planStart, allocStart);

    return {
      categoryId: alloc.categoryId,
      months: buildYear({
        slots,
        spentByMonth: spend.get(alloc.categoryId) ?? new Map(),
        frozenTargets: frozen.get(alloc.categoryId),
        closedThrough,
        monthlyAmount: alloc.amount,
        startMonthIndex,
      }).filter((m) => m.monthIndex >= startMonthIndex),
    };
  });

  if (freeze) await freezeClosedTargets(userId, plan.id, year, ledger, frozen);
  return ledger;
}

/** Record the target of every closed month that doesn't have one yet. */
async function freezeClosedTargets(
  userId: string,
  planId: string,
  year: number,
  ledger: CategoryLedger[],
  frozen: Map<string, Map<number, number>>,
): Promise<void> {
  const rows = ledger.flatMap(({ categoryId, months }) =>
    months
      .filter((m) => m.closed && frozen.get(categoryId)?.get(m.monthIndex) == null)
      .map((m) => ({
        userId,
        budgetId: planId,
        categoryId,
        year,
        monthIndex: m.monthIndex,
        target: m.target,
      })),
  );
  if (rows.length === 0) return;

  // ponytail: chunked — 12 months × categories stays small, but a 60-category
  // plan is 720 rows and libsql caps variables per statement.
  for (let i = 0; i < rows.length; i += 100) {
    await db
      .insert(budgetMonthTargets)
      .values(rows.slice(i, i + 100))
      .onConflictDoNothing();
  }
}

/** Drop a plan's frozen targets — used when it goes back to monthly. */
export async function clearLedger(userId: string, planId: string): Promise<void> {
  await db
    .delete(budgetMonthTargets)
    .where(
      and(eq(budgetMonthTargets.userId, userId), eq(budgetMonthTargets.budgetId, planId)),
    );
}
