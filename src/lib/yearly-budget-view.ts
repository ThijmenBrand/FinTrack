/**
 * The read model for a yearly budget: what the budgets page, the dashboard
 * card, the insights charts and the CSV export all render from.
 *
 * Everything is derived from the transactions and the live allocations at read
 * time — see budget-ledger-db.ts for why there is no cache to go stale.
 */

import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  annualPot,
  envelopeStatus,
  yearSpent,
  type EnvelopeStatus,
  type LedgerMonth,
} from "@/lib/budget-ledger";
import { buildLedgerYear } from "@/lib/budget-ledger-db";
import { getAnnualIncome, currentMonthIndexFor, type AnnualIncome } from "@/lib/annual-income";
import { getFinancialYearMonths, MONTHS_PER_YEAR } from "@/lib/financial-year";
import type { ResolvedBudgetPlan } from "@/lib/budget-plan";

export interface YearlyCategoryView {
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  /** The whole envelope for the year — prorated if the category joined late. */
  annualAmount: number;
  /** This month's own share, before carry-over. */
  monthTarget: number;
  /** What earlier months left behind: positive is saved, negative is owed. */
  rolloverIn: number;
  /** What this month may actually spend: `monthTarget + rolloverIn`. */
  allowance: number;
  spentMonth: number;
  spentYear: number;
  remainingYear: number;
  status: EnvelopeStatus;
  /** Every month of the year, for charts that draw the allowance over time. */
  months: LedgerMonth[];
}

export interface YearlyBudgetView {
  year: number;
  monthIndex: number;
  from: string;
  to: string;
  monthFrom: string;
  monthTo: string;
  income: AnnualIncome;
  totals: {
    annualPot: number;
    spentYear: number;
    remainingYear: number;
    allowanceThisMonth: number;
    spentThisMonth: number;
    rolloverIntoThisMonth: number;
  };
  categories: YearlyCategoryView[];
}

/** Clamp a requested month to a real position in the year. */
export function normaliseMonthIndex(
  requested: number | null | undefined,
  year: number,
  startDay: number,
  now: Date = new Date(),
): number {
  if (requested != null && Number.isInteger(requested)) {
    return Math.max(0, Math.min(MONTHS_PER_YEAR - 1, requested));
  }
  // Default to the month in progress; for a year that is over, its last month.
  const current = currentMonthIndexFor(year, startDay, now);
  if (current < 0) return 0;
  if (current >= MONTHS_PER_YEAR) return MONTHS_PER_YEAR - 1;
  return current;
}

export async function getYearlyBudgetView(
  userId: string,
  plan: ResolvedBudgetPlan,
  year: number,
  monthIndex: number,
  startDay: number,
  now: Date = new Date(),
  // A member viewing a shared plan must not freeze the owner's month targets —
  // reads stay reads. The owner's own visit freezes as before.
  freeze: boolean = true,
): Promise<YearlyBudgetView> {
  const [ledger, income, categoryRows] = await Promise.all([
    buildLedgerYear(userId, plan, year, startDay, now, freeze),
    getAnnualIncome(userId, year, startDay, plan.accountIds, now),
    db
      .select({ id: categories.id, name: categories.name, color: categories.color })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);

  const meta = new Map(categoryRows.map((c) => [c.id, c]));
  const slots = getFinancialYearMonths(year, startDay);

  const categoryViews: YearlyCategoryView[] = ledger.map(({ categoryId, months }) => {
    // Fill any month the ledger has no row for (before the category joined)
    // so charts get a full twelve-point series.
    const byIndex = new Map(months.map((m) => [m.monthIndex, m]));
    const full: LedgerMonth[] = slots.map(
      (slot) =>
        byIndex.get(slot.monthIndex) ?? {
          monthIndex: slot.monthIndex,
          from: slot.from,
          to: slot.to,
          closed: false,
          target: 0,
          spent: 0,
          rolloverIn: 0,
          rolloverOut: 0,
          allowance: 0,
        },
    );

    const viewed = full[monthIndex];
    const pot = annualPot(full);
    const spent = yearSpent(full);
    const info = meta.get(categoryId);

    return {
      categoryId,
      categoryName: info?.name ?? null,
      categoryColor: info?.color ?? null,
      annualAmount: pot,
      monthTarget: viewed.target,
      rolloverIn: viewed.rolloverIn,
      allowance: viewed.allowance,
      spentMonth: viewed.spent,
      spentYear: spent,
      remainingYear: pot - spent,
      status: envelopeStatus(full, monthIndex),
      months: full,
    };
  });

  const totals = categoryViews.reduce(
    (acc, c) => ({
      annualPot: acc.annualPot + c.annualAmount,
      spentYear: acc.spentYear + c.spentYear,
      remainingYear: acc.remainingYear + c.remainingYear,
      allowanceThisMonth: acc.allowanceThisMonth + c.allowance,
      spentThisMonth: acc.spentThisMonth + c.spentMonth,
      rolloverIntoThisMonth: acc.rolloverIntoThisMonth + c.rolloverIn,
    }),
    {
      annualPot: 0,
      spentYear: 0,
      remainingYear: 0,
      allowanceThisMonth: 0,
      spentThisMonth: 0,
      rolloverIntoThisMonth: 0,
    },
  );

  return {
    year,
    monthIndex,
    from: slots[0].from,
    to: slots[MONTHS_PER_YEAR - 1].to,
    monthFrom: slots[monthIndex].from,
    monthTo: slots[monthIndex].to,
    income,
    totals,
    categories: categoryViews.sort((a, b) =>
      (a.categoryName ?? "").localeCompare(b.categoryName ?? ""),
    ),
  };
}
