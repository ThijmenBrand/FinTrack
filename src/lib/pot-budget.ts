/**
 * A pot's budget: lines (with one level of sub-lines) that sum to the pot's
 * targetAmount, each collecting the categories it plans for. Pure — the rules
 * the endpoint enforces and the editor checks before it lets you save are this
 * one module, and the spend attribution the dialog and the dashboard show is
 * computed here from per-category sums the DB layer hands in.
 */
import type { MessageKey } from "@/lib/i18n/translate";
import { MONEY_EPSILON } from "@/lib/validation";
import type {
  PotBudgetLineInput,
  PotBudgetTree,
  PotBudgetView,
  PotLineView,
  PotSpendStatus,
  PotUnplannedGroup,
} from "@/types/api";

/** Every node, sub-lines included. A bound, not a design limit. */
export const MAX_POT_BUDGET_LINES = 100;
export const MAX_POT_LINE_CATEGORIES = 30;
export const MAX_POT_LINE_NAME = 50;
/**
 * Largest amount accepted anywhere in a pot budget. Far past any real pot, and
 * well inside the range where a float still holds every cent exactly.
 */
export const MAX_POT_AMOUNT = 1_000_000_000;
/** Same threshold the monthly budget rows turn amber at. */
export const POT_BUDGET_WARN_PCT = 80;

/** Each rule a budget can break, as the message the user reads. */
export const POT_BUDGET_ERROR = {
  invalid: "pots.budget.err.invalid",
  totalInvalid: "pots.budget.err.totalInvalid",
  totalRequired: "pots.budget.err.totalRequired",
  totalRequiredByDate: "pots.budget.err.totalRequiredByDate",
  sumMismatch: "pots.budget.err.sumMismatch",
  lineName: "pots.budget.err.lineName",
  lineAmount: "pots.budget.err.lineAmount",
  tooDeep: "pots.budget.err.tooDeep",
  tooMany: "pots.budget.err.tooMany",
  tooManyCategories: "pots.budget.err.tooManyCategories",
  duplicateCategory: "pots.budget.err.duplicateCategory",
} as const satisfies Record<string, MessageKey>;

export type PotBudgetError = (typeof POT_BUDGET_ERROR)[keyof typeof POT_BUDGET_ERROR];

export type PotBudgetValidation =
  | { ok: true; value: PotBudgetTree }
  | { ok: false; error: PotBudgetError; categoryId?: string };

export const toCents = (n: number) => Math.round(n * 100);
const round2 = (n: number) => toCents(n) / 100;

function fail(error: PotBudgetError, categoryId?: string): PotBudgetValidation {
  return categoryId ? { ok: false, error, categoryId } : { ok: false, error };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Check a budget and return it normalised: names trimmed, amounts rounded to
 * cents, and every parent's amount replaced by the sum of its children (what
 * a client sends for a parent is ignored rather than trusted).
 *
 * `hasTargetDate`: a dated pot is saving toward its total, so the total can't
 * be cleared while the date stands.
 */
export function validatePotBudget(
  raw: unknown,
  opts: { hasTargetDate: boolean },
): PotBudgetValidation {
  if (!isObject(raw)) return fail(POT_BUDGET_ERROR.invalid);

  let total: number | null = null;
  if (raw.total !== undefined && raw.total !== null) {
    if (typeof raw.total !== "number" || !Number.isFinite(raw.total)) {
      return fail(POT_BUDGET_ERROR.totalInvalid);
    }
    total = round2(raw.total);
    if (total <= 0 || total > MAX_POT_AMOUNT) return fail(POT_BUDGET_ERROR.totalInvalid);
  }

  // Required, even empty: a budget sent without its lines would replace them
  // all with nothing.
  const rawLines = raw.lines;
  if (!Array.isArray(rawLines)) return fail(POT_BUDGET_ERROR.invalid);

  const seen = new Set<string>();
  let count = 0;

  const parseLine = (
    v: unknown,
    depth: number,
  ): PotBudgetLineInput | PotBudgetValidation => {
    if (!isObject(v)) return fail(POT_BUDGET_ERROR.invalid);
    count++;
    if (count > MAX_POT_BUDGET_LINES) return fail(POT_BUDGET_ERROR.tooMany);

    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name || name.length > MAX_POT_LINE_NAME) return fail(POT_BUDGET_ERROR.lineName);

    const rawCats = v.categoryIds ?? [];
    if (!Array.isArray(rawCats)) return fail(POT_BUDGET_ERROR.invalid);
    if (rawCats.length > MAX_POT_LINE_CATEGORIES) return fail(POT_BUDGET_ERROR.tooManyCategories);
    const categoryIds: string[] = [];
    for (const c of rawCats) {
      if (typeof c !== "string" || !c) return fail(POT_BUDGET_ERROR.invalid);
      if (seen.has(c)) return fail(POT_BUDGET_ERROR.duplicateCategory, c);
      seen.add(c);
      categoryIds.push(c);
    }

    const rawChildren = v.children ?? [];
    if (!Array.isArray(rawChildren)) return fail(POT_BUDGET_ERROR.invalid);
    if (rawChildren.length > 0 && depth > 0) return fail(POT_BUDGET_ERROR.tooDeep);
    const children: PotBudgetLineInput[] = [];
    for (const c of rawChildren) {
      const parsed = parseLine(c, depth + 1);
      if ("ok" in parsed) return parsed;
      children.push(parsed);
    }

    let amount: number;
    if (children.length > 0) {
      amount = children.reduce((s, c) => s + toCents(c.amount), 0) / 100;
    } else {
      if (
        typeof v.amount !== "number" ||
        !Number.isFinite(v.amount) ||
        v.amount < 0 ||
        v.amount > MAX_POT_AMOUNT
      ) {
        return fail(POT_BUDGET_ERROR.lineAmount);
      }
      amount = round2(v.amount);
    }
    return { name, amount, categoryIds, children };
  };

  const lines: PotBudgetLineInput[] = [];
  for (const l of rawLines) {
    const parsed = parseLine(l, 0);
    if ("ok" in parsed) return parsed;
    lines.push(parsed);
  }

  if (opts.hasTargetDate && total === null) return fail(POT_BUDGET_ERROR.totalRequiredByDate);
  if (lines.length > 0) {
    if (total === null) return fail(POT_BUDGET_ERROR.totalRequired);
    const planned = lines.reduce((s, l) => s + toCents(l.amount), 0);
    if (planned !== toCents(total)) return fail(POT_BUDGET_ERROR.sumMismatch);
  }

  return { ok: true, value: { total, lines } };
}

export type PotPhase = "none" | "saving" | "spending";

/**
 * Which progress a pot shows. A dated pot is saving toward its total until
 * the target date and spending it from that day on; an undated pot with a
 * total is only ever being spent.
 */
export function potPhase(
  pot: { targetAmount: number | null; targetDate: string | null },
  todayIso: string,
): PotPhase {
  if (pot.targetAmount == null) return "none";
  if (pot.targetDate && todayIso < pot.targetDate) return "saving";
  return "spending";
}

export function spendPct(spent: number, planned: number): number {
  if (planned > 0) return (spent / planned) * 100;
  return spent > MONEY_EPSILON ? 100 : 0;
}

/**
 * Over means over by at least a cent: spending exactly what was planned is
 * the plan working, not a red bar.
 */
export function spendStatus(spent: number, planned: number): PotSpendStatus {
  if (spent > planned + MONEY_EPSILON) return "exceeded";
  return spendPct(spent, planned) >= POT_BUDGET_WARN_PCT ? "warning" : "ok";
}

/** A line as stored: flat, with its categories already gathered. */
export interface StoredPotLine {
  id: string;
  parentId: string | null;
  name: string;
  amount: number;
  sortOrder: number;
  categoryIds: string[];
}

export interface PotLineNode {
  id: string;
  name: string;
  amount: number;
  categoryIds: string[];
  children: PotLineNode[];
}

/**
 * Rebuild the tree from stored rows, in sort order. A row whose parent is
 * missing is promoted to the top level rather than lost; a parent's amount is
 * re-derived from its children rather than trusted.
 */
export function buildLineTree(rows: readonly StoredPotLine[]): PotLineNode[] {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const ids = new Set(rows.map((r) => r.id));
  const tops = sorted.filter((r) => !r.parentId || !ids.has(r.parentId));
  const topIds = new Set(tops.map((r) => r.id));
  return tops.map((top) => {
    const children: PotLineNode[] = sorted
      .filter((r) => r.parentId === top.id && topIds.has(r.parentId))
      .map((c) => ({ id: c.id, name: c.name, amount: c.amount, categoryIds: c.categoryIds, children: [] }));
    return {
      id: top.id,
      name: top.name,
      amount: children.length > 0 ? sumAmounts(children) : top.amount,
      categoryIds: top.categoryIds,
      children,
    };
  });
}

const sumAmounts = (lines: readonly { amount: number }[]) =>
  lines.reduce((s, l) => s + toCents(l.amount), 0) / 100;

/** The stored tree in the shape the editor and the copy action take. */
export function treeToInput(total: number | null, tree: readonly PotLineNode[]): PotBudgetTree {
  const strip = (n: PotLineNode): PotBudgetLineInput => ({
    name: n.name,
    amount: n.amount,
    categoryIds: [...n.categoryIds],
    children: n.children.map(strip),
  });
  return { total, lines: tree.map(strip) };
}

export interface CategoryLine {
  lineId: string;
  lineName: string;
  parentName: string | null;
}

/** Which line each category counts toward. */
export function categoryLineMap(tree: readonly PotLineNode[]): Map<string, CategoryLine> {
  const map = new Map<string, CategoryLine>();
  for (const line of tree) {
    for (const c of line.categoryIds) map.set(c, { lineId: line.id, lineName: line.name, parentName: null });
    for (const child of line.children) {
      for (const c of child.categoryIds) {
        map.set(c, { lineId: child.id, lineName: child.name, parentName: line.name });
      }
    }
  }
  return map;
}

/** Signed SUM(amount) of a pot's spend rows in one category (null = none). */
export interface CategoryNet {
  categoryId: string | null;
  net: number;
}

/**
 * Spread a pot's spending over its lines. Each category's net lands on the
 * line that claims it (a parent's own categories count toward the parent
 * directly); anything unclaimed is Unplanned. Spend is net — a refund in a
 * line's category takes that line's spending back down — and floored at 0 per
 * line, so a line whose refunds outweigh its costs shows nothing spent rather
 * than negative.
 */
export function attributePotSpend(
  total: number | null,
  tree: readonly PotLineNode[],
  nets: readonly CategoryNet[],
): PotBudgetView {
  const lineOf = categoryLineMap(tree);
  const ownNet = new Map<string, number>();
  const unplannedNet = new Map<string | null, number>();
  let allNet = 0;

  for (const { categoryId, net } of nets) {
    allNet += net;
    const line = categoryId ? lineOf.get(categoryId) : undefined;
    if (line) ownNet.set(line.lineId, (ownNet.get(line.lineId) ?? 0) + net);
    else unplannedNet.set(categoryId, (unplannedNet.get(categoryId) ?? 0) + net);
  }

  let worst: PotBudgetView["worstLine"] = null;
  const consider = (view: PotLineView, parentName: string | null) => {
    const overBy = round2(view.spent - view.planned);
    if (view.status !== "exceeded") return;
    // Ties go to the sub-line: it names the actual problem more precisely.
    if (!worst || overBy > worst.overBy || (overBy === worst.overBy && parentName !== null)) {
      worst = { id: view.id, name: view.name, parentName, overBy };
    }
  };

  const toView = (node: PotLineNode, parentName: string | null): PotLineView & { net: number } => {
    const children = node.children.map((c) => toView(c, node.name));
    const net = (ownNet.get(node.id) ?? 0) + children.reduce((s, c) => s + c.net, 0);
    const planned = node.children.length > 0 ? sumAmounts(node.children) : node.amount;
    const spent = round2(Math.max(0, -net));
    const view = {
      id: node.id,
      name: node.name,
      planned,
      spent,
      remaining: round2(planned - spent),
      pct: spendPct(spent, planned),
      status: spendStatus(spent, planned),
      categoryIds: node.categoryIds,
      children: children.map(stripNet),
      net,
    };
    consider(view, parentName);
    return view;
  };

  const lines = tree.map((n) => stripNet(toView(n, null)));

  const groups: PotUnplannedGroup[] = [...unplannedNet.entries()]
    .map(([categoryId, net]) => ({ categoryId, spent: round2(-net) }))
    .filter((g) => g.spent !== 0)
    .sort((a, b) => b.spent - a.spent);
  const unplannedSpent = round2(Math.max(0, -[...unplannedNet.values()].reduce((s, n) => s + n, 0)));

  const spent = round2(Math.max(0, -allNet));
  return {
    total,
    spent,
    remaining: total == null ? null : round2(total - spent),
    pct: total == null ? 0 : spendPct(spent, total),
    status: total == null ? "ok" : spendStatus(spent, total),
    lines,
    unplanned: { spent: unplannedSpent, groups },
    worstLine: worst,
  };
}

function stripNet({ net: _net, ...view }: PotLineView & { net: number }): PotLineView {
  return view;
}
