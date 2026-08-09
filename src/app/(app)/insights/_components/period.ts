import type { I18n } from "@/lib/i18n/translate";

// Date maths for the insights header and the spending pace. Every date here is
// a plain YYYY-MM-DD string; `new Date(iso)` would read those as UTC midnight
// and render a day early west of UTC, so they're parsed as local midnight.
const localDate = (iso: string) => new Date(`${iso}T00:00:00`);

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Jul 7 – Aug 6, 2026". Empty bounds (All Time) have no range to state. */
export function formatRangeLabel(i18n: I18n, from: string, to: string): string {
  if (!from || !to) return i18n.t("insights.allTimeLabel");
  const f = i18n.formatDayMonth(localDate(from));
  const t = new Intl.DateTimeFormat(i18n.intlLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(localDate(to));
  return `${f} – ${t}`;
}

/**
 * Days of the range that have already happened — the denominator for a
 * spending pace, which shouldn't be diluted by days that haven't arrived yet.
 * Falls back to the span of the data itself when the range is unbounded.
 */
export function elapsedDays(
  from: string,
  to: string,
  dailyTotals: { date: string }[],
  now: Date = new Date(),
): number {
  const start = from || dailyTotals[0]?.date;
  const last = to || dailyTotals[dailyTotals.length - 1]?.date;
  if (!start || !last) return 0;
  const today = toIso(now);
  const end = last > today ? today : last;
  if (end < start) return 0;
  return (
    Math.round(
      (localDate(end).getTime() - localDate(start).getTime()) / 86400000,
    ) + 1
  );
}

/** Whole days left in the range, 0 once it has ended. */
export function daysLeftIn(to: string, now: Date = new Date()): number {
  if (!to) return 0;
  const ms = new Date(`${to}T23:59:59`).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}
