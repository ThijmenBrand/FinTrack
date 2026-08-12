import { getFinancialMonthRange } from "@/lib/financial-month";
import type { I18n } from "@/lib/i18n/translate";

/**
 * Resolve the financial-month range for `offset` periods before the one
 * containing `now`. Walks backward in calendar months from the current FM
 * start so each offset lands on a real FM boundary regardless of startDay.
 */
export function getFinancialMonthForOffset(
  now: Date,
  startDay: number,
  offset: number,
): { from: string; to: string; reference: Date } {
  const currentRange = getFinancialMonthRange(now, startDay);
  const currentStart = new Date(currentRange.from + "T00:00:00");
  const targetStart = new Date(
    currentStart.getFullYear(),
    currentStart.getMonth() - offset,
    currentStart.getDate(),
  );
  const range = getFinancialMonthRange(targetStart, startDay);
  return { ...range, reference: targetStart };
}

// ponytail: kept hand-rolled — Intl.RelativeTimeFormat would change the
// output (its month bucketing differs from this days/30 approximation).
export function formatRelative(i18n: I18n, iso: string | null): string {
  const { t, plural } = i18n;
  if (!iso) return t("budgets.relative.never");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("budgets.relative.never");
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return t("budgets.relative.today");
  if (days === 1) return t("budgets.relative.yesterday");
  if (days < 30) return t("budgets.relative.daysAgo", { count: days });
  const months = Math.floor(days / 30);
  return plural(months, "budgets.relative.monthsAgo.one", "budgets.relative.monthsAgo.other");
}
