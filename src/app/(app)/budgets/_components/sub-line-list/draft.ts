import type { BudgetChildInput } from "@/hooks/use-budgets";
import { sumLines } from "@/lib/budget-cache";
import { toMonthly } from "@/lib/recurring";

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
  /** An existing plan this line adopts. */
  adoptRecurringId?: string;
  /** Or one to create alongside it, in the shape the POST validates. */
  recurring?: NonNullable<BudgetChildInput["recurring"]>;
}

/**
 * The two shapes a link travels in: the id of a plan being adopted, or the
 * plan block itself once it is saved. `frequency` is named only so this stays
 * a strong type — both halves carry one, and a lone optional `id` would make
 * every unrelated object assignable.
 */
interface Linkable {
  adoptRecurringId?: string;
  recurring?: { id?: string; frequency: string };
  children: Linkable[];
}

/**
 * Every recurring plan the tree already stands for. The adoption list subtracts
 * these, so a plan can't be offered twice — the server rejects a second link
 * anyway, but being offered something that then fails is not an answer.
 */
export function linkedPlanIds(lines: readonly Linkable[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly Linkable[]) => {
    for (const node of nodes) {
      const id = node.adoptRecurringId ?? node.recurring?.id;
      if (id) ids.add(id);
      walk(node.children);
    }
  };
  walk(lines);
  return ids;
}

/**
 * What this category's own recurring plans commit it to that no line in the
 * tree stands for yet, expressed monthly.
 *
 * Those payments land in the category whether or not the budget mentions them,
 * so an allocation below this figure is over budget the day it is created.
 * Paused plans are left out — they take nothing this month, so demanding room
 * for them would be the opposite mistake.
 */
export function uncoveredMonthly(
  plans: readonly {
    id: string;
    amount: number;
    frequency: string;
    isActive: boolean;
  }[],
  adopted: ReadonlySet<string>,
): number {
  return plans
    .filter((p) => p.isActive && !adopted.has(p.id))
    .reduce((sum, p) => sum + toMonthly(p.amount, p.frequency), 0);
}

/**
 * Those same plans as draft lines, ready to seed the add dialog's tree: each
 * one adopts the plan it came from, expressed monthly. Paused plans are left
 * out for the same reason `uncoveredMonthly` skips them — nothing is due.
 */
export function adoptDrafts(
  plans: readonly {
    id: string;
    description: string;
    amount: number;
    frequency: string;
    isActive: boolean;
  }[],
): DraftLine[] {
  return plans
    .filter((p) => p.isActive)
    .map((p) => ({
      id: crypto.randomUUID(),
      name: p.description,
      amount: toMonthly(p.amount, p.frequency),
      children: [],
      adoptRecurringId: p.id,
    }));
}

/**
 * The draft tree as the rows want to read it. A container's amount is resolved
 * here rather than stored, so editing a leaf re-totals everything above it
 * without a second copy of the number to keep in step.
 */
export function toLineNodes(
  lines: readonly DraftLine[],
  planOf: (id: string) => LinkedPlan | undefined,
): LineNode[] {
  return lines.map((line) => {
    const children = toLineNodes(line.children, planOf);
    const recurring = line.recurring
      ? {
          frequency: line.recurring.frequency,
          dayOfWeek: line.recurring.dayOfWeek ?? null,
          dayOfMonth: line.recurring.dayOfMonth ?? null,
          monthOfYear: line.recurring.monthOfYear ?? null,
          startDate: line.recurring.startDate,
        }
      : line.adoptRecurringId
        ? planOf(line.adoptRecurringId)
        : undefined;
    return {
      id: line.id,
      name: line.name,
      amount: children.length > 0 ? sumLines(children) : line.amount,
      children,
      ...(recurring ? { recurring } : {}),
    };
  });
}

/**
 * The draft tree as `POST /api/budgets` wants it. The server re-derives every
 * container and every linked line, so the amount travelling for those is a
 * placeholder it overwrites — it is sent only because the endpoint validates
 * that every node carries a positive one.
 */
export function toChildInput(lines: readonly DraftLine[]): BudgetChildInput[] {
  return lines.map((line) => ({
    name: line.name,
    amount: line.children.length > 0 ? sumLines(line.children) : line.amount,
    ...(line.children.length > 0 ? { children: toChildInput(line.children) } : {}),
    ...(line.adoptRecurringId ? { adoptRecurringId: line.adoptRecurringId } : {}),
    ...(line.recurring ? { recurring: line.recurring } : {}),
  }));
}
