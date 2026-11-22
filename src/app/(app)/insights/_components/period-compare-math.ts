// Pure maths behind the period-vs-period comparison. Kept out of the
// component so the arithmetic that decides "€40 more, 12% up" is testable
// without rendering anything.
//
// Throughout: `a` is the period the page is showing, `b` the one it is being
// held against. Deltas read a − b, so positive always means "more in A".

import { toIsoDate } from "@/lib/utils";

const localDate = (iso: string) => new Date(`${iso}T00:00:00`);

export interface CompareSummary {
  totalIncome: number;
  totalExpenses: number;
  net: number;
  txCount: number;
}

export interface CompareSide {
  from: string;
  to: string;
  summary: CompareSummary;
  /** Days of the period already spent — the denominator for per-day figures. */
  elapsedDays: number;
}

export type MetricKey =
  | "income"
  | "expenses"
  | "net"
  | "savingsRate"
  | "txCount"
  | "perDay";

export interface MetricRow {
  key: MetricKey;
  /** Null when the figure can't be computed (savings rate without income). */
  a: number | null;
  b: number | null;
  /** a − b, null when either side is missing. */
  delta: number | null;
  /** Percentage change against b; null when b is zero (or either is missing). */
  pct: number | null;
  /** Whether a rise is the good direction, or null when it is neither. */
  upIsGood: boolean | null;
  format: "currency" | "percent" | "count";
}

/** Inclusive length of a period in days; 0 when either bound is missing. */
export function periodDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const days =
    Math.round(
      (localDate(to).getTime() - localDate(from).getTime()) / 86400000,
    ) + 1;
  return days > 0 ? days : 0;
}

/**
 * Percentage change from `b` to `a`. Null when there's no base to grow from,
 * and null when the two straddle zero: a net of +€690 becoming −€2,853 is not
 * "513% down", it is a different kind of month, and the euro figure says so.
 */
export function percentChange(a: number, b: number): number | null {
  if (b === 0) return null;
  if (a < 0 !== b < 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

const savingsRate = (s: CompareSummary): number | null =>
  s.totalIncome > 0 ? (s.net / s.totalIncome) * 100 : null;

const perDay = (s: CompareSummary, days: number): number | null =>
  days > 0 ? s.totalExpenses / days : null;

function row(
  key: MetricKey,
  a: number | null,
  b: number | null,
  upIsGood: boolean | null,
  format: MetricRow["format"],
): MetricRow {
  const delta = a !== null && b !== null ? a - b : null;
  return {
    key,
    a,
    b,
    delta,
    pct: a !== null && b !== null ? percentChange(a, b) : null,
    upIsGood,
    format,
  };
}

/**
 * The headline table: one row per figure, each with both sides and the change.
 * `perDay` is here because two periods are rarely the same length — it is the
 * only expense figure that stays honest when they aren't.
 */
export function buildMetricRows(a: CompareSide, b: CompareSide): MetricRow[] {
  return [
    row("income", a.summary.totalIncome, b.summary.totalIncome, true, "currency"),
    row("expenses", a.summary.totalExpenses, b.summary.totalExpenses, false, "currency"),
    row("net", a.summary.net, b.summary.net, true, "currency"),
    row("savingsRate", savingsRate(a.summary), savingsRate(b.summary), true, "percent"),
    // Fewer transactions is neither good nor bad — it gets no colour.
    row("txCount", a.summary.txCount, b.summary.txCount, null, "count"),
    row(
      "perDay",
      perDay(a.summary, a.elapsedDays),
      perDay(b.summary, b.elapsedDays),
      false,
      "currency",
    ),
  ];
}

export interface BreakdownEntry {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  total: number;
}

export interface CategoryCompareRow {
  categoryId: string | null;
  name: string;
  color: string;
  a: number;
  b: number;
  /** a − b: positive means this category cost more in A. */
  delta: number;
  pct: number | null;
  /** Whether the category carried spending in only one of the two periods. */
  status: "both" | "onlyA" | "onlyB";
}

const catKey = (id: string | null) => id ?? "none";

/**
 * Every category either period spent in, paired up and sorted by the size of
 * the change — the first rows are what actually moved between the two.
 */
export function buildCategoryRows(
  aBreakdown: BreakdownEntry[],
  bBreakdown: BreakdownEntry[],
): CategoryCompareRow[] {
  const rows = new Map<string, CategoryCompareRow>();

  const ensure = (entry: BreakdownEntry): CategoryCompareRow => {
    const key = catKey(entry.categoryId);
    const existing = rows.get(key);
    if (existing) return existing;
    const created: CategoryCompareRow = {
      categoryId: entry.categoryId,
      name: entry.categoryName,
      color: entry.categoryColor,
      a: 0,
      b: 0,
      delta: 0,
      pct: null,
      status: "both",
    };
    rows.set(key, created);
    return created;
  };

  for (const entry of aBreakdown) ensure(entry).a += entry.total;
  // B's names and colours only fill gaps: a category renamed between the two
  // periods should read under the name it has now.
  for (const entry of bBreakdown) ensure(entry).b += entry.total;

  const out = [...rows.values()].map((r) => ({
    ...r,
    delta: r.a - r.b,
    pct: percentChange(r.a, r.b),
    status: r.b === 0 ? ("onlyA" as const) : r.a === 0 ? ("onlyB" as const) : ("both" as const),
  }));

  // Biggest movers first; ties fall back to the larger of the two totals so
  // the order is stable rather than insertion-dependent.
  return out.sort(
    (x, y) =>
      Math.abs(y.delta) - Math.abs(x.delta) ||
      Math.max(y.a, y.b) - Math.max(x.a, x.b),
  );
}

/**
 * Running expense total per day of the period, indexed from day 1. Days with
 * no transactions carry the previous total forward, so the two curves can be
 * read against each other at any day index even when one period is quiet.
 *
 * Length is the period's own length, capped at its last day with data when the
 * period is still running — a half-finished month shouldn't draw a flat line
 * across the days that haven't happened.
 */
export function cumulativeByDay(
  dailyTotals: { date: string; expenses: number }[],
  from: string,
  to: string,
  now: Date = new Date(),
): number[] {
  if (!from) return [];
  const length = periodDays(from, to);
  if (length === 0) return [];

  const today = toIsoDate(now);
  const lastDay = to > today ? today : to;
  const drawnDays = Math.min(length, periodDays(from, lastDay));
  if (drawnDays === 0) return [];

  const byIndex = new Array<number>(drawnDays).fill(0);
  const start = localDate(from).getTime();
  for (const d of dailyTotals) {
    const i = Math.round((localDate(d.date).getTime() - start) / 86400000);
    if (i >= 0 && i < drawnDays) byIndex[i] += d.expenses;
  }

  let running = 0;
  return byIndex.map((v) => (running += v));
}
