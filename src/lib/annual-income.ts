/**
 * Annual income for a yearly budget.
 *
 * Multiplying one month's pay by twelve is wrong in any country with holiday
 * pay: a Dutch salary lands a full extra month in May, plus whatever a 13th
 * month or bonus adds. So the year is assembled from what actually happened
 * where that is known, and only projected where it isn't:
 *
 *   - months that have finished  → the income transactions they really saw
 *   - the month in progress      → max(actual so far, the recurring plan),
 *                                  so early in the month the salary is still
 *                                  reserved and a bigger-than-planned payment
 *                                  is reflected once it lands
 *   - months still to come       → the recurring income plan
 *
 * Same max(planned, actual) shape the fixed-costs maths in month-money.ts
 * already uses, applied to the income side.
 */

import { db } from "@/db";
import { recurringTransactions, transactions } from "@/db/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { toMonthly } from "@/lib/recurring";
import { accountScopeFilter } from "@/lib/budget-plan";
import {
  closedMonthCount,
  currentFinancialSlot,
  getFinancialYearRange,
  MONTHS_PER_YEAR,
} from "@/lib/financial-year";
import { financialMonthBucketExpr, parseBucket } from "@/lib/financial-bucket";

export interface AnnualIncome {
  /** Income that has actually arrived in the finished months of this year. */
  actual: number;
  /** Recurring income standing in for the months not yet banked. */
  projected: number;
  total: number;
  monthsBanked: number;
  monthsProjected: number;
}

export interface CombineAnnualIncomeInput {
  actualByMonth: Map<number, number>;
  /** Monthly equivalent of every active recurring income plan. */
  monthlyRecurring: number;
  /** Months of this year that have fully elapsed. */
  closedThrough: number;
  /**
   * Index of the month in progress, or -1 when the year is entirely in the
   * future and 12 when it is entirely in the past.
   */
  currentMonthIndex: number;
}

/** The pure part: fold twelve months of evidence and plan into one figure. */
export function combineAnnualIncome({
  actualByMonth,
  monthlyRecurring,
  closedThrough,
  currentMonthIndex,
}: CombineAnnualIncomeInput): AnnualIncome {
  let actual = 0;
  let projected = 0;
  let monthsBanked = 0;
  let monthsProjected = 0;

  for (let i = 0; i < MONTHS_PER_YEAR; i++) {
    const banked = actualByMonth.get(i) ?? 0;

    if (i < closedThrough) {
      actual += banked;
      monthsBanked++;
      continue;
    }
    if (i === currentMonthIndex) {
      // Whichever is larger — the pay that already landed, or the plan that
      // says more is still coming.
      if (banked >= monthlyRecurring) {
        actual += banked;
        monthsBanked++;
      } else {
        projected += monthlyRecurring;
        monthsProjected++;
      }
      continue;
    }
    if (i > currentMonthIndex) {
      projected += monthlyRecurring;
      monthsProjected++;
    }
  }

  return {
    actual,
    projected,
    total: actual + projected,
    monthsBanked,
    monthsProjected,
  };
}

/**
 * Income for one financial year, scoped to a plan's accounts. Recurring plans
 * live on an account, so a Joint budget only counts the salary paid into joint
 * accounts — the same scoping every other per-plan figure uses.
 */
export async function getAnnualIncome(
  userId: string,
  year: number,
  startDay: number,
  accountIds: string[] | undefined,
  now: Date = new Date(),
): Promise<AnnualIncome> {
  const { from, to } = getFinancialYearRange(year, startDay);
  const scope = accountScopeFilter(accountIds);
  const bucket = financialMonthBucketExpr(startDay);

  const recurringScope =
    accountIds === undefined
      ? undefined
      : accountIds.length > 0
        ? inArray(recurringTransactions.accountId, accountIds)
        : sql`1=0`;

  const [incomeRows, recurringIncome] = await Promise.all([
    db
      .select({
        bucket: sql<string>`${bucket}`,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "income"),
          // Grouped rows are a pot's internal accounting, not new money.
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to),
          ...(scope ? [scope] : []),
        ),
      )
      .groupBy(sql`${bucket}`),

    db
      .select({
        amount: recurringTransactions.amount,
        frequency: recurringTransactions.frequency,
      })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.userId, userId),
          eq(recurringTransactions.type, "income"),
          eq(recurringTransactions.isActive, true),
          ...(recurringScope ? [recurringScope] : []),
        ),
      ),
  ]);

  const actualByMonth = new Map<number, number>();
  for (const row of incomeRows) {
    if (!row.bucket) continue;
    const slot = parseBucket(row.bucket);
    if (slot.year !== year) continue;
    actualByMonth.set(
      slot.monthIndex,
      (actualByMonth.get(slot.monthIndex) ?? 0) + (Number(row.total) || 0),
    );
  }

  const monthlyRecurring = recurringIncome.reduce(
    (sum, r) => sum + toMonthly(r.amount, r.frequency),
    0,
  );

  return combineAnnualIncome({
    actualByMonth,
    monthlyRecurring,
    closedThrough: closedMonthCount(year, startDay, now),
    currentMonthIndex: currentMonthIndexFor(year, startDay, now),
  });
}

/**
 * Which month of `year` is in progress: -1 when the year hasn't started,
 * 12 when it is over.
 */
export function currentMonthIndexFor(
  year: number,
  startDay: number,
  now: Date = new Date(),
): number {
  const slot = currentFinancialSlot(startDay, now);
  if (slot.year < year) return -1;
  if (slot.year > year) return MONTHS_PER_YEAR;
  return slot.monthIndex;
}
