import { toIsoDate } from "@/lib/utils";

/**
 * Widen a date range so a monthly trend always has history behind it: the union
 * of the selected range and the trailing `months` calendar months ending today.
 * A null bound means unbounded (All Time) and stays null — already wider.
 */
export function trendWindow(
  dateFrom: string | null,
  dateTo: string | null,
  months: number,
  today = new Date(),
): { from: string | null; to: string | null } {
  const start = new Date(today);
  start.setDate(1); // before the month shift, so Jan 31 → Dec 1, not Dec 31
  start.setMonth(start.getMonth() - (months - 1));
  const trendFrom = toIsoDate(start);
  const trendTo = toIsoDate(today);
  return {
    from: dateFrom ? (dateFrom < trendFrom ? dateFrom : trendFrom) : null,
    to: dateTo ? (dateTo > trendTo ? dateTo : trendTo) : null,
  };
}
