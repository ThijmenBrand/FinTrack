import type { BudgetChildInput } from "@/hooks/use-budgets";
import type { BudgetSubLine } from "@/types/api";
import { sumLines } from "@/lib/budget-cache";

// The tree edits are the same at every level of this feature — a draft, a
// saved sub-line and an optimistic cache patch all key on `id` and hold
// `children` — so they live next to the cache patches that also need them.
export { addLine, removeLine, sumLines, updateLine } from "@/lib/budget-cache";

/**
 * The plan a line stands for, reduced to what a row has to show: which cadence
 * it runs on and when it next falls due. A saved sub-line's `recurring` block
 * carries more than this; a drafted one carries less. Both satisfy it.
 */
export interface LinkedPlan {
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  /** Absent on a drafted line — nothing that has never been saved is paused. */
  isActive?: boolean;
}

/**
 * One row of the tree, whichever half of the dialog produced it: a saved
 * `BudgetSubLine` satisfies this shape as it stands, and so does a line that
 * so far only exists in the add dialog's local draft. The rows render this and
 * nothing else, which is why add and edit share one set of components.
 */
export interface LineNode {
  /** The sub-line's id once saved; a local key while it is only a draft. */
  id: string;
  name: string;
  /** Stored (monthly) units, like `BudgetSubLine.amount`. */
  amount: number;
  children: LineNode[];
  recurring?: LinkedPlan;
  /** Client-side only: an optimistic write for this line is still in flight. */
  pending?: boolean;
}

/**
 * The plan a line stands for, whole: everything a row needs to render plus the
 * id the write needs to make the link. `LinkedPlan` is the display half of it,
 * so a drafted line satisfies both.
 */
export type FiledPlan = NonNullable<BudgetSubLine["recurring"]>;

/**
 * A line in the add dialog, before anything has been written. Its money is in
 * stored units so it can be summed against saved lines without a conversion
 * step in the middle.
 */
export interface DraftLine {
  /** Local until the line is written; `LineNode.id` reads it straight. */
  id: string;
  name: string;
  /** Ignored once the line has children — they are what it adds up to. */
  amount: number;
  children: DraftLine[];
  /**
   * Set when the line IS a recurring payment. Its id may still be a local
   * `draft:…` one — the plan is created in the same save — so `save.ts` maps
   * it before sending.
   */
  recurring?: FiledPlan;
}

/**
 * The draft tree as the rows want to read it. A container's amount is resolved
 * here rather than stored, so editing a leaf re-totals everything above it
 * without a second copy of the number to keep in step.
 */
export function toLineNodes(lines: readonly DraftLine[]): LineNode[] {
  return lines.map((line) => {
    const children = toLineNodes(line.children);
    return {
      id: line.id,
      name: line.name,
      amount: children.length > 0 ? sumLines(children) : line.amount,
      children,
      ...(line.recurring ? { recurring: line.recurring } : {}),
    };
  });
}

/**
 * The draft tree as `POST /api/budgets` wants it. The server re-derives every
 * container, so the amount travelling for one is a placeholder it overwrites —
 * it is sent only because the endpoint validates that every node carries a
 * positive one.
 *
 * A line filed under a recurring payment travels as `adoptRecurringId`, and
 * the server derives its amount from that plan. The id may still be local when
 * this runs — the plan is created earlier in the same save — so `save.ts` maps
 * it through the ids the run collected before the call goes out.
 */
export function toChildInput(lines: readonly DraftLine[]): BudgetChildInput[] {
  return lines.map((line) => ({
    name: line.name,
    amount: line.children.length > 0 ? sumLines(line.children) : line.amount,
    ...(line.children.length > 0 ? { children: toChildInput(line.children) } : {}),
    ...(line.recurring ? { adoptRecurringId: line.recurring.id } : {}),
  }));
}
