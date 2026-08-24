import type { BudgetSubLine } from "@/types/api";

// One shape for every line of the plan: a disclosure chevron, then the category
// and its progress bar taking whatever width is going, then a fixed-width column
// on the right carrying the budgeted amount over how the period is going.
//
// The right column is fixed rather than content-sized so the amounts form a
// straight column down the list — a ragged one makes two rows look like
// different orders of magnitude when they aren't.
export const ROW_SHELL =
  "flex w-full items-start gap-3 px-4 py-3 text-left sm:gap-4";
/** The chevron. Its width plus margin is exactly what ROW_INDENT re-creates. */
export const ROW_CHEVRON = "mr-1.5 mt-1 h-3.5 w-3.5 shrink-0";
export const ROW_ASIDE = "shrink-0 text-right w-[7.5rem] sm:w-60 lg:w-72";
/**
 * Detail under a row starts where its name does, past the chevron: 16px of row
 * padding + a 14px chevron + its 6px margin. `LIST_INDENT` in the sub-line list
 * is the same 36px, so sub-lines and expanded detail hang off one edge.
 */
export const ROW_INDENT = "pl-9";

/**
 * Sub-rows of the same list: the recurring plans that sit under a category, and
 * the loading skeleton. They carry no bar and no disclosure, so they get a grid
 * rather than the shell — but the amount is the LAST track, at the same 8rem
 * from the right edge the shell's aside ends at, so every figure on the page
 * still falls in one column. The controls sit inboard of it rather than past
 * it, which is the only way both can be true.
 *
 * Mobile stacks to two lines: dot · name · amount, then the controls under it.
 */
export const SUB_ROW_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_6rem_8rem]";
export const CELL_ACTIONS =
  "col-start-3 row-start-2 justify-self-end sm:col-auto sm:row-auto";
export const CELL_AMOUNT = "col-start-3 row-start-1 sm:col-auto sm:row-auto";

/**
 * Red for spent-out, amber for tight. Every row of the plan reads the same:
 * a monthly allocation, a yearly envelope and a fixed-cost category disagree
 * about what those mean — over the month's cap, out of the annual pot, more
 * paid than planned — but they look the same and say the same thing, so they
 * share one palette. An empty `bar` means "fill with the category's own
 * colour": a healthy row is identified by its category, not by its status.
 *
 * `received` is the one tone that reads the other way. On an income row the
 * plan being exceeded is the good news, so it borrows the emerald the whole app
 * already uses for money coming in rather than the red that means overspend.
 * Both themes carry it, like every other tone here.
 */
/**
 * The three state colours as text, at the darkest step that still reads as the
 * colour rather than as brown or bottle green.
 *
 * The 600s are what the rest of the app uses on headings and totals, but they
 * carry a state here on 12px facts: amber-600 lands around 3.2:1 on a white
 * card and emerald-600 around 3.4:1, both of which are large-text ratios. The
 * 700s clear 4.5:1. The dark theme keeps the 400s — against a near-black card
 * those already clear the same bar, and darkening them there would do the
 * opposite of this.
 *
 * Exported because the stat strip and the suggestion rows sit on the same page
 * and state has to mean one colour, not three shades of one.
 */
export const TONE_TEXT = {
  negative: "text-red-700 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  positive: "text-emerald-700 dark:text-emerald-400",
} as const;

export const TONE = {
  exceeded: {
    bar: "#ef4444",
    text: TONE_TEXT.negative,
    badge: `border-red-500/40 ${TONE_TEXT.negative}`,
  },
  warning: {
    bar: "#f59e0b",
    text: TONE_TEXT.warning,
    badge: `border-amber-500/40 ${TONE_TEXT.warning}`,
  },
  received: {
    bar: "#10b981",
    text: TONE_TEXT.positive,
    badge: `border-emerald-500/40 ${TONE_TEXT.positive}`,
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
 * How an income category is doing this period, in the same terms as a fixed
 * cost — and with the same cent of slack, so a salary that landed to the last
 * cent counts as in rather than still owing.
 *
 * The tone is the mirror image of `fixedCostStatus`: money arriving beyond the
 * plan is a windfall, not an overspend, so this never returns `exceeded`. It
 * tops out at emerald and warns amber only while income is still outstanding —
 * a payday that has not landed is exactly the kind of thing amber is for.
 *
 * Nothing expected and nothing in means every plan in the category is paused.
 * That is neither good news nor a warning, so it stays neutral: claiming a
 * category is "received" when it never expected a cent would be a lie.
 */
export function incomeStatus(line?: { expected: number; received: number }) {
  const expected = line?.expected ?? 0;
  const received = line?.received ?? 0;
  // Nothing planned but money in (a bonus, a side gig with no plan) is fully
  // "received" — there is no outstanding remainder to be a fraction of. Reading
  // 0% there would render a windfall as an empty bar.
  const percentage =
    expected > 0 ? (received / expected) * 100 : received > 0 ? 100 : 0;
  const outstanding = expected - received;
  return {
    expected,
    received,
    percentage,
    outstanding,
    status:
      expected === 0 && received === 0
        ? ("ok" as Tone)
        : outstanding <= 0.01
          ? ("received" as Tone)
          : ("warning" as Tone),
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

/**
 * Every recurring plan id already absorbed by a sub-line, at any depth, across
 * every allocation on screen. The sub-line row shows the plan's frequency and
 * next-due date itself, so `useRecurringPlans` must drop these ids from the
 * standalone recurring rows it groups per category — otherwise the same bill
 * renders twice: once as a sub-line, once as its own row underneath.
 *
 * Keyed by plan id rather than by category: a category's allocation can carry
 * one linked sub-line and two ordinary ones, and only the linked plan's row
 * should disappear — the rest of that category's plans stay exactly as
 * visible as before.
 */
export function linkedRecurringIds(
  allocations: { subLines: BudgetSubLine[] }[],
): Set<string> {
  const ids = new Set<string>();
  const walk = (lines: BudgetSubLine[]) => {
    for (const line of lines) {
      if (line.recurring) ids.add(line.recurring.id);
      if (line.children.length > 0) walk(line.children);
    }
  };
  for (const alloc of allocations) walk(alloc.subLines);
  return ids;
}
