// Financial-month math. `startDay` is 1–28; 1 reduces to calendar months.

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

// `n` financial months ending with the one containing `reference` (inclusive).
export function getLastNFinancialMonths(
  reference: Date,
  startDay: number,
  n: number,
): { from: string; to: string } {
  const day = clampStartDay(startDay);
  const count = Math.max(1, Math.round(n));
  const currentStart = financialMonthStart(reference, day);
  const earliestStart = new Date(currentStart.getFullYear(), currentStart.getMonth() - (count - 1), day);
  const end = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, day - 1);
  return { from: toIsoDate(earliestStart), to: toIsoDate(end) };
}
