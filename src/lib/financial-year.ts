/**
 * Financial-year math for yearly budgets.
 *
 * A financial year is twelve consecutive financial months, so the months tile
 * the year exactly and twelve monthly figures always sum to the annual one.
 * The year is named after the calendar year its first financial month starts
 * in: with `startDay = 1` that is just Jan 1 – Dec 31, and with `startDay = 25`
 * financial year 2026 runs 25 Jan 2026 – 24 Jan 2027.
 *
 * `monthIndex` is a month's position in that year, 0–11, which is also the
 * calendar month its financial month starts in.
 */

import { clampStartDay, getFinancialMonthRange } from "@/lib/financial-month";
import { toIsoDate } from "@/lib/utils";

export const MONTHS_PER_YEAR = 12;

export interface FinancialMonthSlot {
  monthIndex: number;
  from: string;
  to: string;
}

/** Local-midnight Date for an ISO `YYYY-MM-DD`, matching financial-month.ts. */
function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * The financial year `reference` falls in — the calendar year in which its
 * financial month began. In early January with a late `startDay`, that is the
 * year before: 10 Jan 2026 with startDay 25 still belongs to 2025.
 */
export function financialYearOf(reference: Date, startDay: number): number {
  const { from } = getFinancialMonthRange(reference, startDay);
  return parseIso(from).getFullYear();
}

/** The twelve financial months of `year`, in order. */
export function getFinancialYearMonths(
  year: number,
  startDay: number,
): FinancialMonthSlot[] {
  const day = clampStartDay(startDay);
  return Array.from({ length: MONTHS_PER_YEAR }, (_, monthIndex) => {
    const start = new Date(year, monthIndex, day);
    const { from, to } = getFinancialMonthRange(start, day);
    return { monthIndex, from, to };
  });
}

/** Outer bounds of the financial year — first month's start, last month's end. */
export function getFinancialYearRange(
  year: number,
  startDay: number,
): { from: string; to: string } {
  const months = getFinancialYearMonths(year, startDay);
  return { from: months[0].from, to: months[MONTHS_PER_YEAR - 1].to };
}

/** Where an ISO date sits: which financial year, and which month inside it. */
export function financialSlotOf(
  isoDate: string,
  startDay: number,
): { year: number; monthIndex: number } {
  const { from } = getFinancialMonthRange(parseIso(isoDate), startDay);
  const start = parseIso(from);
  return { year: start.getFullYear(), monthIndex: start.getMonth() };
}

/** Today's slot — the month a live yearly budget is currently spending from. */
export function currentFinancialSlot(
  startDay: number,
  now: Date = new Date(),
): { year: number; monthIndex: number } {
  return financialSlotOf(toIsoDate(now), startDay);
}

/**
 * Months of `year` that have completely finished as of `now`. These are the
 * ones whose ledger rows freeze: their target no longer follows the live
 * allocation. The current month and everything after it stay open.
 */
export function closedMonthCount(
  year: number,
  startDay: number,
  now: Date = new Date(),
): number {
  const today = toIsoDate(now);
  return getFinancialYearMonths(year, startDay).filter((m) => m.to < today)
    .length;
}
