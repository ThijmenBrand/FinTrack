// Financial-month math. `startDay` is 1–28; 1 reduces to calendar months.

import { toIsoDate } from "@/lib/utils";

export function clampStartDay(startDay: number): number {
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

// Where `reference` sits inside its financial month. `elapsedDays` and
// `daysLeft` both count today, so they overlap by one and sum to totalDays + 1.
// `progress` drives the "today" markers on budget bars.
export function getPeriodProgress(reference: Date, startDay: number) {
  const { from, to } = getFinancialMonthRange(reference, startDay);
  // Parse as local midnight so the math matches the local `todayMs` below.
  const startMs = new Date(`${from}T00:00:00`).getTime();
  const endMs = new Date(`${to}T00:00:00`).getTime();
  const totalDays = Math.round((endMs - startMs) / 86400000) + 1;
  const todayMs = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
  ).getTime();
  const elapsedDays = Math.min(
    totalDays,
    Math.max(1, Math.round((todayMs - startMs) / 86400000) + 1),
  );
  return {
    from,
    to,
    totalDays,
    elapsedDays,
    daysLeft: totalDays - elapsedDays + 1,
    progress: totalDays > 0 ? elapsedDays / totalDays : 0,
  };
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
