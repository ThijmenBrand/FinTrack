/**
 * Optimistic patches for a cached `GET /api/budgets` payload.
 *
 * The budgets page reads its whole plan out of one query, so a write that only
 * moved the row it touched would leave the stats and the list header
 * disagreeing with the rows under them until the refetch landed. These
 * functions move the row AND everything derived from it, mirroring what the
 * endpoint derives on read. Pure, so the arithmetic is checked without a cache
 * or a server.
 */
import { annualPot, cascade, envelopeStatus, yearSpent } from "@/lib/budget-ledger";
import type {
  Allocation,
  BudgetData,
  YearlyBudgetView,
  YearlyCategoryView,
} from "@/types/api";

/** Money is stored as floats; the endpoint rounds its totals to cents. */
const cents = (n: number) => Math.round(n * 100) / 100;

/** Anything with children, keyed by id: a saved sub-line or a drafted one. */
interface TreeNode {
  id: string;
  amount: number;
  children: TreeNode[];
}

/**
 * What a set of lines adds up to. A line with children is worth its children
 * rather than its own stored figure — that inversion is the whole feature, and
 * it has to hold for an allocation that predates it and was never re-summed.
 */
export function sumLines<T extends { amount: number; children: T[] }>(
  lines: readonly T[],
): number {
  return lines.reduce(
    (total, line) =>
      total + (line.children.length > 0 ? sumLines(line.children) : line.amount),
    0,
  );
}

/** Append a line to a container, or to the roots when `parentId` is null. */
export function addLine<T extends TreeNode>(
  lines: T[],
  parentId: string | null,
  line: T,
): T[] {
  if (parentId === null) return [...lines, line];
  return lines.map((l) =>
    l.id === parentId
      ? { ...l, children: [...l.children, line] }
      : { ...l, children: addLine(l.children as T[], parentId, line) },
  );
}

export function updateLine<T extends TreeNode>(
  lines: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return lines.map((l) =>
    l.id === id
      ? { ...l, ...patch }
      : { ...l, children: updateLine(l.children as T[], id, patch) },
  );
}

export function removeLine<T extends TreeNode>(lines: T[], id: string): T[] {
  return lines
    .filter((l) => l.id !== id)
    .map((l) => ({ ...l, children: removeLine(l.children as T[], id) }));
}

/** Whether the tree holds this line at any depth. */
export function hasLine(lines: readonly TreeNode[], id: string): boolean {
  return lines.some((l) => l.id === id || hasLine(l.children, id));
}

/**
 * A container is its children, at every level — the client half of
 * `resyncUpwards`. A container with no children keeps its own amount, which is
 * what the endpoint's `count > 0` guard says too: removing the last child
 * leaves the parent's budget where it was rather than zeroing it.
 */
export function rollUp<T extends TreeNode>(lines: T[]): T[] {
  return lines.map((line) => {
    const children = rollUp(line.children as T[]);
    return {
      ...line,
      children,
      // The children are rolled up already, so their own amounts are final.
      amount:
        children.length > 0
          ? children.reduce((sum, c) => sum + c.amount, 0)
          : line.amount,
    };
  });
}

/** An allocation's tree rewritten, with the new total rolled up into it. */
export function withSubLines(
  alloc: Allocation,
  lines: Allocation["subLines"],
): Allocation {
  const subLines = rollUp(lines);
  return {
    ...alloc,
    subLines,
    amount:
      subLines.length > 0
        ? subLines.reduce((sum, l) => sum + l.amount, 0)
        : alloc.amount,
  };
}

/** Spend against a cap, derived the way `GET /api/budgets` derives it. */
export function reprice(alloc: Allocation): Allocation {
  // Spending against a cap of nothing is over budget, not "ok" — mirrors the
  // endpoint.
  const percentage =
    alloc.amount > 0
      ? (alloc.spent / alloc.amount) * 100
      : alloc.spent > 0
        ? 100
        : 0;
  return {
    ...alloc,
    remaining: Math.max(0, alloc.amount - alloc.spent),
    percentage: Math.round(percentage * 10) / 10,
    status: percentage >= 100 ? "exceeded" : percentage >= 80 ? "warning" : "ok",
  };
}

/** Everything a create knows about the row before the server answers. */
type NewAllocation = Pick<
  Allocation,
  "categoryId" | "categoryName" | "categoryColor" | "amount" | "spent"
>;

/**
 * Where a create lands: the category's existing row at its new amount, or a
 * new row. `POST /api/budgets` upserts per category, and accepting a
 * suggestion goes through the same endpoint, so both take this path.
 *
 * The id is a placeholder until the refetch brings the real one — the row it
 * marks stays `pending`, and the list doesn't offer to edit or delete it.
 */
export function upsertAllocation(
  allocations: Allocation[],
  row: NewAllocation,
): Allocation[] {
  const existing = allocations.find((a) => a.categoryId === row.categoryId);
  if (existing) {
    return allocations.map((a) =>
      a === existing ? { ...a, amount: row.amount, pending: true } : a,
    );
  }
  return [
    ...allocations,
    {
      ...row,
      id: `pending:${crypto.randomUUID()}`,
      // Filled in by `reprice` below; the averages arrive with the refetch.
      remaining: 0,
      percentage: 0,
      status: "ok",
      avgMonthly: 0,
      avgMonths: 0,
      subLines: [],
      pending: true,
    },
  ];
}

/**
 * One envelope re-run through the carry-over chain at a new monthly amount —
 * the client half of `getYearlyBudgetView`. Closed months keep the target they
 * closed with, so a raise only reaches the rest of the year.
 */
function recascade(
  category: YearlyCategoryView,
  monthlyAmount: number,
  monthIndex: number,
): YearlyCategoryView {
  // ponytail: the envelope's first month is read back off the targets rather
  // than carried in the payload. Only a zero allocation makes that ambiguous;
  // send startMonthIndex from the server if it ever stops being so.
  const first = category.months.findIndex((m) => m.target > 0);
  const months = cascade(
    category.months.map((m) => ({ ...m, frozenTarget: m.target })),
    { monthlyAmount, startMonthIndex: Math.max(0, first) },
  );
  const viewed = months[monthIndex];
  const pot = annualPot(months);
  const spent = yearSpent(months);
  return {
    ...category,
    annualAmount: pot,
    monthTarget: viewed.target,
    rolloverIn: viewed.rolloverIn,
    allowance: viewed.allowance,
    spentMonth: viewed.spent,
    spentYear: spent,
    remainingYear: pot - spent,
    status: envelopeStatus(months, monthIndex),
    months,
  };
}

function yearlyTotals(
  categories: YearlyCategoryView[],
): YearlyBudgetView["totals"] {
  return categories.reduce(
    (acc, c) => ({
      annualPot: acc.annualPot + c.annualAmount,
      spentYear: acc.spentYear + c.spentYear,
      remainingYear: acc.remainingYear + c.remainingYear,
      allowanceThisMonth: acc.allowanceThisMonth + c.allowance,
      spentThisMonth: acc.spentThisMonth + c.spentMonth,
      rolloverIntoThisMonth: acc.rolloverIntoThisMonth + c.rolloverIn,
    }),
    {
      annualPot: 0,
      spentYear: 0,
      remainingYear: 0,
      allowanceThisMonth: 0,
      spentThisMonth: 0,
      rolloverIntoThisMonth: 0,
    },
  );
}

/**
 * Change a payload's allocations and carry the change through everything the
 * endpoint derives from them: each row's spend-vs-cap, the plan totals, and a
 * yearly plan's envelopes.
 *
 * ponytail: a yearly envelope is re-cascaded when its allocation moves and
 * dropped when the allocation goes, but a brand-new category gets no envelope
 * here — the year's per-month spend behind it isn't in this payload, so it
 * would have to be invented. Those rows appear when the refetch lands.
 */
export function patchBudget(
  data: BudgetData,
  change: (allocations: Allocation[]) => Allocation[],
): BudgetData {
  const before = new Map(data.allocations.map((a) => [a.categoryId, a.amount]));
  const allocations = change(data.allocations).map(reprice);
  const after = new Map(allocations.map((a) => [a.categoryId, a.amount]));

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const yearly = data.yearly;
  const categories = yearly?.categories.flatMap((c) => {
    const amount = after.get(c.categoryId);
    if (amount === undefined) return []; // allocation deleted
    if (amount === before.get(c.categoryId)) return [c];
    return [recascade(c, amount, yearly.monthIndex)];
  });

  // Bills whose category has no allocation — the endpoint's `ownFixedCosts`.
  // Recomputed here rather than read off `data.totalFixedCosts` because the
  // patch may be the very change that gives a fixed-cost category an
  // allocation, and from that moment its plans belong to that row alone.
  const allocatedCategoryIds = new Set(allocations.map((a) => a.categoryId));
  const ownFixedCosts = data.fixedCosts.reduce(
    (sum, fc) =>
      allocatedCategoryIds.has(fc.categoryId) ? sum : sum + fc.monthlyAmount,
    0,
  );

  return {
    ...data,
    allocations,
    totalAllocated: cents(totalAllocated),
    availableToAllocate: cents(data.monthlyIncome - ownFixedCosts),
    unallocated: cents(data.monthlyIncome - ownFixedCosts - totalAllocated),
    totalBudget: cents(ownFixedCosts + totalAllocated),
    yearly:
      yearly && categories
        ? { ...yearly, categories, totals: yearlyTotals(categories) }
        : yearly,
  };
}
