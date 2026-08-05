// One column template for every budget list row. Each row is its own grid, so
// the tracks only line up across rows when the trailing columns are fixed
// widths — otherwise the amount text sizes its own column and the bars go ragged.
//
// Mobile stacks to two lines: dot · name · amount, then bar · delta underneath.
const BASE =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5";

export const ROW_GRID = `${BASE} sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(96px,2fr)_9.5rem_6.5rem]`;

export const CELL_BAR =
  "col-start-2 row-start-2 sm:col-auto sm:row-auto sm:px-2";
export const CELL_AMOUNT = "col-start-3 row-start-1 sm:col-auto sm:row-auto";
/** Trailing column: the over/left delta on budget rows, actions on suggestions. */
export const CELL_DELTA =
  "col-start-3 row-start-2 text-right sm:col-auto sm:row-auto";

/** Same 80% warning threshold the API uses for a single allocation. */
export function usageTone(spent: number, limit: number) {
  if (spent > limit) {
    return { bar: "bg-red-500", text: "text-red-600 dark:text-red-400" };
  }
  if (limit > 0 && spent / limit >= 0.8) {
    return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
  }
  return { bar: "bg-emerald-500", text: "text-muted-foreground" };
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
