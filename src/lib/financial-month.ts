// Financial-month math. `startDay` is 1–28; 1 reduces to calendar months.

import { toIsoDate } from "@/lib/utils";

function clampStartDay(startDay: number): number {
  if (!Number.isFinite(startDay)) return 1;
  return Math.max(1, Math.min(28, Math.round(startDay)));
}

// Start of the financial month that contains `reference`.
// If reference's day-of-month >= startDay, the window started this calendar month;
// otherwise it started the previous calendar month.
function financialMonthStart(reference: Date, startDay: number): Date {
  const day = clampStartDay(startDay);
  const year = reference.getFullYear();
  const month = reference.getMonth();
  if (reference.getDate() >= day) {
    return new Date(year, month, day);
  }
  return new Date(year, month - 1, day);
}

// Window that contains `reference`: [start of FM, day before start of next FM].
export function getFinancialMonthRange(
  reference: Date,
  startDay: number,
): { from: string; to: string } {
  const day = clampStartDay(startDay);
  const start = financialMonthStart(reference, day);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, day - 1);
  return { from: toIsoDate(start), to: toIsoDate(end) };
}

// The financial month immediately before the one containing `reference`.
export function getPreviousFinancialMonth(
  reference: Date,
  startDay: number,
): { from: string; to: string } {
  const day = clampStartDay(startDay);
  const currentStart = financialMonthStart(reference, day);
  const prevStart = new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, day);
  const prevEnd = new Date(currentStart.getFullYear(), currentStart.getMonth(), day - 1);
  return { from: toIsoDate(prevStart), to: toIsoDate(prevEnd) };
}

// Human label for the financial month that contains `reference`.
// `startDay === 1` reduces to a calendar-month label ("May 2026"); otherwise
// returns the explicit range ("Apr 27 – May 26").
export function formatFinancialMonthLabel(
  reference: Date,
  startDay: number,
  locale: string = "en-US",
): string {
  const day = clampStartDay(startDay);
  if (day === 1) {
    return reference.toLocaleDateString(locale, { month: "long", year: "numeric" });
  }
  const { from, to } = getFinancialMonthRange(reference, day);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  // Parse as local midnight — new Date("YYYY-MM-DD") would parse as UTC and
  // render a day early in UTC-negative timezones.
  const local = (iso: string) => new Date(`${iso}T00:00:00`);
  const fromStr = local(from).toLocaleDateString(locale, fmt);
  const toStr = local(to).toLocaleDateString(locale, fmt);
  return `${fromStr} – ${toStr}`;
}
