/**
 * The pot budget editor's state, as plain data. Amounts stay the text the user
 * typed until they're sent, so a half-typed "12." isn't rounded away under
 * their cursor; a parent's amount is never typed at all — it is its children.
 * The rules a draft has to pass are `validatePotBudget`'s, run on the payload
 * this builds, so the editor and the endpoint can't disagree about "valid".
 */
import { toCents, validatePotBudget, type PotBudgetValidation } from "@/lib/pot-budget";
import type { PotBudgetLineInput, PotBudgetTree } from "@/types/api";

export interface DraftLine {
  /** Local key; saved lines get fresh ids on every save anyway. */
  key: string;
  name: string;
  amount: string;
  categoryIds: string[];
  children: DraftLine[];
}

export interface PotBudgetDraft {
  total: string;
  /** YYYY-MM-DD, or "" for none. */
  targetDate: string;
  lines: DraftLine[];
}

export interface PotBudgetPayload extends PotBudgetTree {
  targetDate: string | null;
}

const newKey = () => crypto.randomUUID();

/** Typed text as a number: null when empty, NaN when it isn't one. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(",", "."));
}

/** A number as editor text: whole euros without decimals, cents with two. */
export function formatAmount(n: number): string {
  const cents = toCents(n);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function emptyDraft(): PotBudgetDraft {
  return { total: "", targetDate: "", lines: [] };
}

function lineFromInput(l: PotBudgetLineInput): DraftLine {
  return {
    key: newKey(),
    name: l.name,
    amount: formatAmount(l.amount),
    categoryIds: [...l.categoryIds],
    children: l.children.map(lineFromInput),
  };
}

export function draftFromTree(tree: PotBudgetTree, targetDate: string | null): PotBudgetDraft {
  return {
    total: tree.total == null ? "" : formatAmount(tree.total),
    targetDate: targetDate ?? "",
    lines: tree.lines.map(lineFromInput),
  };
}

/** What a line is worth right now: its children, or its own typed amount. */
export function lineCents(line: DraftLine): number {
  if (line.children.length > 0) return line.children.reduce((s, c) => s + lineCents(c), 0);
  const n = parseAmount(line.amount);
  return n == null || !Number.isFinite(n) ? 0 : toCents(n);
}

export type AllocationState = "noLines" | "noTotal" | "match" | "under" | "over";

/**
 * How the lines stand against the total, for the indicator above them.
 * `diff` is total − planned in euros: positive is still unallocated.
 */
export function draftAllocation(d: PotBudgetDraft): {
  state: AllocationState;
  planned: number;
  total: number | null;
  diff: number;
} {
  const plannedCents = d.lines.reduce((s, l) => s + lineCents(l), 0);
  const parsed = parseAmount(d.total);
  const total = parsed != null && Number.isFinite(parsed) ? toCents(parsed) / 100 : null;
  const planned = plannedCents / 100;
  if (d.lines.length === 0) return { state: "noLines", planned, total, diff: 0 };
  if (total == null) return { state: "noTotal", planned, total, diff: 0 };
  const diffCents = toCents(total) - plannedCents;
  const state = diffCents === 0 ? "match" : diffCents > 0 ? "under" : "over";
  return { state, planned, total, diff: diffCents / 100 };
}

function lineToInput(l: DraftLine): PotBudgetLineInput {
  const children = l.children.map(lineToInput);
  const parsed = parseAmount(l.amount);
  return {
    name: l.name,
    // An empty leaf is a mistake to report, not a zero to save quietly.
    amount: children.length > 0 ? lineCents(l) / 100 : parsed ?? Number.NaN,
    categoryIds: l.categoryIds,
    children,
  };
}

export function toPayload(d: PotBudgetDraft): PotBudgetPayload {
  const total = parseAmount(d.total);
  return {
    total: total == null ? null : total,
    targetDate: d.targetDate || null,
    lines: d.lines.map(lineToInput),
  };
}

export function validateDraft(d: PotBudgetDraft): PotBudgetValidation {
  return validatePotBudget(toPayload(d), { hasTargetDate: !!d.targetDate });
}

/** Whether saving `d` would change anything about what was loaded. */
export function draftChanged(d: PotBudgetDraft, original: PotBudgetDraft): boolean {
  const strip = (x: PotBudgetDraft) => {
    const p = toPayload(x);
    const norm = (l: PotBudgetLineInput): unknown => [l.name.trim(), toCents(l.amount || 0), l.categoryIds, l.children.map(norm)];
    return JSON.stringify([p.total == null ? null : toCents(p.total), p.targetDate, p.lines.map(norm)]);
  };
  return strip(d) !== strip(original);
}

/** Categories already on a line — the pickers leave them out. */
export function usedCategoryIds(d: PotBudgetDraft): Set<string> {
  const used = new Set<string>();
  const walk = (lines: DraftLine[]) => {
    for (const l of lines) {
      for (const c of l.categoryIds) used.add(c);
      walk(l.children);
    }
  };
  walk(d.lines);
  return used;
}

function mapLines(lines: DraftLine[], key: string, fn: (l: DraftLine) => DraftLine): DraftLine[] {
  return lines.map((l) => (l.key === key ? fn(l) : { ...l, children: mapLines(l.children, key, fn) }));
}

/**
 * A new top-level line. With part of the total still unallocated, the line
 * starts out holding that remainder — the usual reason to add a line is to
 * place what's left.
 */
export function addLine(
  d: PotBudgetDraft,
  init: { name?: string; amount?: number; categoryIds?: string[] } = {},
): PotBudgetDraft {
  const { state, diff, total } = draftAllocation(d);
  const remainder = state === "noLines" ? total ?? 0 : state === "under" ? diff : 0;
  const amount = init.amount ?? remainder;
  return {
    ...d,
    lines: [
      ...d.lines,
      {
        key: newKey(),
        name: init.name ?? "",
        amount: amount > 0 ? formatAmount(amount) : "",
        categoryIds: init.categoryIds ?? [],
        children: [],
      },
    ],
  };
}

/**
 * A sub-line under `parentKey`. The first one takes over the parent's own
 * amount, so splitting a line doesn't change what it's worth.
 */
export function addSubLine(d: PotBudgetDraft, parentKey: string): PotBudgetDraft {
  return {
    ...d,
    lines: d.lines.map((l) => {
      if (l.key !== parentKey) return l;
      const inherit = l.children.length === 0 ? l.amount : "";
      return {
        ...l,
        children: [...l.children, { key: newKey(), name: "", amount: inherit, categoryIds: [], children: [] }],
      };
    }),
  };
}

export function updateLine(
  d: PotBudgetDraft,
  key: string,
  patch: Partial<Pick<DraftLine, "name" | "amount">>,
): PotBudgetDraft {
  return { ...d, lines: mapLines(d.lines, key, (l) => ({ ...l, ...patch })) };
}

/**
 * Remove a line (and its sub-lines). Removing a parent's last sub-line hands
 * their total back to the parent, so the line keeps its worth.
 */
export function removeLine(d: PotBudgetDraft, key: string): PotBudgetDraft {
  const lines = d.lines
    .filter((l) => l.key !== key)
    .map((l) => {
      if (!l.children.some((c) => c.key === key)) return l;
      const children = l.children.filter((c) => c.key !== key);
      return children.length > 0 ? { ...l, children } : { ...l, children, amount: formatAmount(lineCents(l) / 100) };
    });
  return { ...d, lines };
}

export function addCategory(d: PotBudgetDraft, key: string, categoryId: string): PotBudgetDraft {
  if (usedCategoryIds(d).has(categoryId)) return d;
  return { ...d, lines: mapLines(d.lines, key, (l) => ({ ...l, categoryIds: [...l.categoryIds, categoryId] })) };
}

export function removeCategory(d: PotBudgetDraft, key: string, categoryId: string): PotBudgetDraft {
  return {
    ...d,
    lines: mapLines(d.lines, key, (l) => ({ ...l, categoryIds: l.categoryIds.filter((c) => c !== categoryId) })),
  };
}

/** "Match total to lines": the total becomes what the lines add up to. */
export function matchTotalToLines(d: PotBudgetDraft): PotBudgetDraft {
  return { ...d, total: formatAmount(draftAllocation(d).planned) };
}

/**
 * Turn an Unplanned category into its own line, planned at what it has cost
 * so far. The total is left alone — the indicator then says how far over the
 * lines are, and the user decides where that comes from.
 */
export function addFromUnplanned(
  d: PotBudgetDraft,
  category: { id: string; name: string },
  spent: number,
): PotBudgetDraft {
  if (usedCategoryIds(d).has(category.id)) return d;
  return addLine(d, { name: category.name, amount: Math.max(0, spent), categoryIds: [category.id] });
}

/** Another pot's lines and total, in place of this draft's; the date stays. */
export function copyFrom(d: PotBudgetDraft, source: PotBudgetTree): PotBudgetDraft {
  return { ...draftFromTree(source, null), targetDate: d.targetDate };
}
