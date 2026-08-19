// One column template for every budget list row. Each row is its own grid, so
// the tracks only line up across rows when the trailing columns are fixed
// widths — otherwise the amount text sizes its own column and the bars go ragged.
//
// Mobile stacks to two lines: dot · name · amount, then bar · delta underneath.
// The trailing tracks are minmax(0,…) so a long note (a localised "€1,073.87
// left this year") shrinks and ellipsises inside its own column instead of
// spilling over the amount next to it.
const BASE =
  "grid grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] items-center gap-x-3 gap-y-1.5 px-4 py-2.5";

export const ROW_GRID = `${BASE} sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(96px,2fr)_9.5rem_minmax(0,10.5rem)]`;

export const CELL_BAR =
  "col-start-2 row-start-2 sm:col-auto sm:row-auto sm:px-2";
export const CELL_AMOUNT = "col-start-3 row-start-1 sm:col-auto sm:row-auto";
/** Trailing column: the over/left delta on budget rows, actions on suggestions. */
export const CELL_DELTA =
  "col-start-3 row-start-2 min-w-0 text-right sm:col-auto sm:row-auto";

/**
 * Red for spent-out, amber for tight. Every row of the plan reads the same:
 * a monthly allocation, a yearly envelope and a fixed-cost category disagree
 * about what those mean — over the month's cap, out of the annual pot, more
 * paid than planned — but they look the same and say the same thing, so they
 * share one palette. An empty `bar` means "fill with the category's own
 * colour": a healthy row is identified by its category, not by its status.
 */
export const TONE = {
  exceeded: {
    bar: "#ef4444",
    text: "text-red-600 dark:text-red-400",
    badge: "border-red-500/40 text-red-600 dark:text-red-400",
  },
  warning: {
    bar: "#f59e0b",
    text: "text-amber-600 dark:text-amber-400",
    badge: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  },
  ok: { bar: "", text: "text-muted-foreground", badge: "" },
} as const;

export type Tone = keyof typeof TONE;

/** The API's warning threshold for a single allocation, as a percentage. */
export const WARN_PCT = 80;

/**
 * How a fixed-cost category is doing this month, in the same terms as an
 * allocation. Shared by the row and by the list that sorts it in among the
 * allocations, so the bar's colour and the row's position can't disagree by a
 * cent. Undefined means every plan in the category is paused: nothing planned,
 * nothing owed.
 */
export function fixedCostStatus(fc?: { monthlyAmount: number; spent: number }) {
  const limit = fc?.monthlyAmount ?? 0;
  const spent = fc?.spent ?? 0;
  const percentage = limit > 0 ? (spent / limit) * 100 : 0;
  const outstanding = limit - spent;
  return {
    limit,
    spent,
    percentage,
    outstanding,
    // A cent of slack: a bill paid to the last cent is settled, not exceeded.
    status:
      outstanding <= -0.01
        ? ("exceeded" as Tone)
        : percentage >= WARN_PCT
          ? ("warning" as Tone)
          : ("ok" as Tone),
  };
}

/**
 * Urgency order from the design: over budget first, then by how much of the
 * budget is used, so untouched categories sink to the bottom.
 */
export function byUrgency(
  a: { status: string; percentage: number },
  b: { status: string; percentage: number },
) {
  return (
    Number(b.status === "exceeded") - Number(a.status === "exceeded") ||
    b.percentage - a.percentage
  );
}
