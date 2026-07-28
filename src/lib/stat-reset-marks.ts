// Pure date maths for statistics resets. Kept free of `@/db` so chart
// components can import it. Server-side lookups live in `@/lib/stat-reset`.
//
// All dates are ISO `YYYY-MM-DD`, so lexicographic comparison is date
// comparison — the same assumption every date filter in this codebase makes.

/**
 * Narrow a query's lower date bound so it never reaches past the cutoff.
 * Returns null only when neither bound exists (i.e. genuinely unbounded).
 */
export function clampFrom(
  from: string | null | undefined,
  cutoff: string | null,
): string | null {
  if (!cutoff) return from ?? null;
  if (!from) return cutoff;
  return from > cutoff ? from : cutoff;
}

/**
 * True when a date falls in the era before the cutoff. The cutoff day itself
 * is the first day of the new era, so it is never "before".
 */
export function isBeforeCutoff(
  date: string | null | undefined,
  cutoff: string | null,
): boolean {
  if (!cutoff || !date) return false;
  return date < cutoff;
}

export interface ResetMark {
  /** Index in the chart's entry list that this reset sits immediately before. */
  index: number;
  date: string;
  note: string | null;
  /** True for the newest reset — the one that actually governs the maths. */
  isActive: boolean;
}

/**
 * Place reset markers between a chart's buckets.
 *
 * A bucket spans `[start, end]`. A reset lands immediately before the first
 * bucket whose `end` reaches the reset date, so the rule is drawn at the left
 * edge of the bucket the reset falls inside (weekly and monthly buckets can
 * straddle it) or the first bucket of the new era (daily buckets never do).
 *
 * Resets outside the plotted range are dropped: a rule pinned to the chart
 * edge would imply a boundary the data doesn't show.
 */
export function placeResetMarks(
  buckets: { start: string; end: string }[],
  resets: { date: string; note: string | null }[],
  activeDate: string | null,
): ResetMark[] {
  if (buckets.length === 0) return [];
  const first = buckets[0].start;
  const last = buckets[buckets.length - 1].end;
  const marks: ResetMark[] = [];
  const seen = new Set<number>();

  for (const reset of resets) {
    if (reset.date <= first || reset.date > last) continue;
    const index = buckets.findIndex((b) => b.end >= reset.date);
    if (index <= 0 || seen.has(index)) continue;
    seen.add(index);
    marks.push({
      index,
      date: reset.date,
      note: reset.note,
      isActive: reset.date === activeDate,
    });
  }
  return marks.sort((a, b) => a.index - b.index);
}

/** "12 Mar 2026" — the label used on every reset marker. */
export function formatResetDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
