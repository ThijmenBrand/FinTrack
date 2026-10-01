/**
 * The two colours a suggestion can wear in the editor, one per kind of change.
 *
 * Neither is a status colour on purpose. Amber and red already mean "careful"
 * and "over" on these pages, so a proposed change painted in them would read
 * as a warning about the row. Violet is the suggestion's own hue — a change to
 * a line already in the plan. Emerald is the diff convention for "added": a
 * line the plan does not have yet. Text keeps to the 700 / 300 shades for the
 * same contrast reason `TONE_TEXT` gives.
 */
export type ReviewTone = "changed" | "added";

const EDGE =
  "relative before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-['']";

export const REVIEW_TONE = {
  changed: {
    /** A bar down the row's left edge: findable while scrolling a long plan. */
    edge: `${EDGE} before:bg-violet-500`,
    wash: "bg-violet-500/[0.03]",
    panel: "border-violet-500/30 bg-violet-500/[0.07]",
    text: "text-violet-700 dark:text-violet-300",
    chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    swatch: "bg-violet-500",
  },
  added: {
    edge: `${EDGE} before:bg-emerald-500`,
    wash: "bg-emerald-500/[0.03]",
    panel: "border-emerald-500/30 bg-emerald-500/[0.07]",
    text: "text-emerald-700 dark:text-emerald-300",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    swatch: "bg-emerald-500",
  },
} as const satisfies Record<ReviewTone, Record<string, string>>;
