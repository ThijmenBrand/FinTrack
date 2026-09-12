import type { Allocation, BudgetSubLine, RecurringTx } from "@/types/api";
import { addLine, removeLine, rollUp, updateLine } from "@/lib/budget-cache";
import { toChildInput, type DraftLine } from "../sub-line-list/draft";
import type { BudgetChildInput } from "@/hooks/use-budgets";

/**
 * The unsaved half of the budget editor.
 *
 * A patch over the server's answer, never a copy of it. That is the whole
 * design: a refetch landing mid-edit (a recurring plan changed in the dialog,
 * a suggestion accepted, the window refocused) can never clobber what has been
 * typed, because what has been typed is not the list — it is the difference
 * from it. `overlay` puts the two together for rendering, `toSteps` turns the
 * difference into the calls that make it true.
 *
 * Amounts are in STORED units (monthly), like everything else that touches
 * `budgets.amount`. A yearly plan's fields divide and multiply at the edge.
 */
export interface Draft {
  /** allocationId → the amount typed over it. */
  amounts: Record<string, number>;
  /** allocationIds struck through, gone only once Save runs. */
  removed: string[];
  /** Categories given a budget in this session, with their whole tree. */
  added: NewAllocation[];
  /**
   * Sub-line changes to allocations that already exist, in the order they were
   * made. A log rather than a tree diff: the three endpoints behind it take one
   * line at a time, so the log IS the request list, and replaying it needs no
   * before-and-after comparison that could disagree with what was clicked.
   */
  ops: SubLineOp[];
  /**
   * Recurring payments added in this session, carried as the rows they will
   * become so the list and the totals can count them before they exist. Their
   * ids are local (`draft:…`); the server issues the real ones on Save.
   *
   * Drafted for the same reason an allocation is: a recurring payment IS part
   * of what the plan costs, and one that wrote itself the moment the dialog
   * closed would move the figures under a Save button that stayed greyed out.
   */
  recurring: RecurringTx[];
}

/**
 * A category budgeted for the first time. It carries its own tree rather than
 * ops, because `POST /api/budgets` writes an allocation and its whole
 * breakdown in one transaction — there is no id to hang an op off until that
 * call returns.
 */
export interface NewAllocation {
  /** Local, for React keys and for `removed`. The server issues the real id. */
  key: string;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  /** Ignored once `lines` has anything in it — a container is its children. */
  amount: number;
  lines: DraftLine[];
}

export type SubLineOp =
  | {
      kind: "add";
      allocationId: string;
      parentId: string | null;
      /** Local until saved; later ops in this log may already reference it. */
      id: string;
      name: string;
      amount: number;
    }
  | { kind: "update"; allocationId: string; id: string; name: string; amount: number }
  | { kind: "remove"; allocationId: string; id: string };

export const EMPTY_DRAFT: Draft = {
  amounts: {},
  removed: [],
  added: [],
  ops: [],
  recurring: [],
};

/**
 * How many changes are waiting — the number on the save bar.
 *
 * Counted as requests rather than as draft entries, because that is what the
 * bar is promising: a row added and then removed again nets to nothing, and so
 * does an amount typed over a row that is on its way out. Saying "2 unsaved
 * changes" about a plan that would come out identical is how a save bar loses
 * the user's trust, and `toSteps` already knows exactly which edits survive.
 */
export function changeCount(draft: Draft): number {
  return toSteps(draft).length;
}

/** An allocation as the editor renders it: the server's, with the draft over it. */
export interface EditorRow extends Allocation {
  /** Struck through, waiting for Save to make it true. */
  removed: boolean;
  /** Never saved: it has no id, no spend and no history yet. */
  isNew: boolean;
  /** The local tree of a new row; absent on a saved one. */
  lines?: DraftLine[];
}

/**
 * Every row the editor shows, in the order the plan is read: what already
 * exists (patched), then what has been added in this session.
 *
 * A removed row stays in the list. It has to: deletion only becomes real on
 * Save, and a row that vanished on click would leave nothing to undo.
 */
export function overlay(allocations: Allocation[], draft: Draft): EditorRow[] {
  const removed = new Set(draft.removed);
  const saved = allocations.map((alloc) => {
    const subLines = applyOps(
      alloc.subLines,
      draft.ops.filter((op) => op.allocationId === alloc.id),
    );
    return {
      ...alloc,
      subLines,
      // A container is its children, at every level — the client half of what
      // `resyncUpwards` does on the server. Without this a typed amount and
      // the breakdown under it would disagree until the page reloaded.
      amount:
        subLines.length > 0
          ? subLines.reduce((sum, line) => sum + line.amount, 0)
          : draft.amounts[alloc.id] ?? alloc.amount,
      removed: removed.has(alloc.id),
      isNew: false,
    };
  });

  const fresh = draft.added.map<EditorRow>((row) => ({
    id: row.key,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    amount: row.lines.length > 0 ? sumDraft(row.lines) : row.amount,
    // Nothing has been spent against a line that does not exist yet, and
    // claiming otherwise would put a progress figure on an empty plan.
    spent: 0,
    remaining: 0,
    percentage: 0,
    status: "ok",
    avgMonthly: 0,
    avgMonths: 0,
    subLines: [],
    removed: removed.has(row.key),
    isNew: true,
    lines: row.lines,
  }));

  return [...saved, ...fresh];
}

/** A draft tree's total, with containers resolved the way the server resolves them. */
export function sumDraft(lines: readonly DraftLine[]): number {
  return lines.reduce(
    (total, line) =>
      total + (line.children.length > 0 ? sumDraft(line.children) : line.amount),
    0,
  );
}

/** The saved tree with this session's ops laid over it, then re-totalled. */
export function applyOps(
  lines: BudgetSubLine[],
  ops: readonly SubLineOp[],
): BudgetSubLine[] {
  let out = lines;
  for (const op of ops) {
    if (op.kind === "add") {
      out = addLine(out, op.parentId, {
        id: op.id,
        parentId: op.parentId,
        name: op.name,
        amount: op.amount,
        children: [],
      });
    } else if (op.kind === "update") {
      out = updateLine(out, op.id, { name: op.name, amount: op.amount });
    } else {
      out = removeLine(out, op.id);
    }
  }
  return rollUp(out);
}

// ─── Saving ──────────────────────────────────────────────────────────────────

/**
 * One request. The draft is turned into a flat, ordered list of these before
 * anything is sent, so the order is decided in one place and can be read (and
 * tested) without a network.
 */
export type Step =
  | { kind: "remove"; id: string }
  | { kind: "amount"; id: string; amount: number }
  | {
      kind: "create";
      key: string;
      categoryId: string;
      amount: number;
      children: BudgetChildInput[];
    }
  | { kind: "op"; op: SubLineOp }
  | { kind: "recurring"; tx: RecurringTx };

/**
 * The draft as requests, in the only order that is safe:
 *
 * 1. Removals, so a category freed here can be re-budgeted in the same save —
 *    the endpoint refuses two allocations for one category in one plan.
 * 2. Amounts, before the sub-line ops that may re-derive them upward.
 * 3. Creates, which carry their own breakdown in the same call.
 * 4. Sub-line ops, in the order they were made: a line added at step 4 can be
 *    the parent of the line added at step 5.
 * 5. Recurring payments, which depend on nothing here — the server derives the
 *    fixed-cost and income lines from them on the next read.
 *
 * A removed allocation's own ops are dropped: it is about to not exist, and
 * editing a sub-line of it would only 404 on the way out. So are the ops on a
 * sub-line added and then removed again in this same session — the server never
 * heard of it, and writing it just to delete it can fail the whole run (the
 * tree endpoint refuses a fourth level, or a fifteenth line) over a change the
 * user already took back.
 */
export function toSteps(draft: Draft): Step[] {
  const removed = new Set(draft.removed);
  const added = new Set(draft.ops.flatMap((op) => (op.kind === "add" ? [op.id] : [])));
  const cancelled = new Set(
    draft.ops.flatMap((op) => (op.kind === "remove" && added.has(op.id) ? [op.id] : [])),
  );
  // Removing a container takes its whole subtree off screen but logs one op, so
  // the lines drafted under it go with it here.
  for (const op of draft.ops) {
    if (op.kind === "add" && op.parentId && cancelled.has(op.parentId)) {
      cancelled.add(op.id);
    }
  }
  return [
    // A row added and removed in the same session was never written, so there
    // is nothing to delete — it just never gets created below.
    ...draft.removed
      .filter((id) => !draft.added.some((row) => row.key === id))
      .map<Step>((id) => ({ kind: "remove", id })),
    ...Object.entries(draft.amounts)
      .filter(([id]) => !removed.has(id))
      .map<Step>(([id, amount]) => ({ kind: "amount", id, amount })),
    ...draft.added
      .filter((row) => !removed.has(row.key))
      .map<Step>((row) => ({
        kind: "create",
        key: row.key,
        categoryId: row.categoryId,
        amount: row.lines.length > 0 ? sumDraft(row.lines) : row.amount,
        children: toChildInput(row.lines),
      })),
    ...draft.ops
      .filter((op) => !removed.has(op.allocationId) && !cancelled.has(op.id))
      .map<Step>((op) => ({ kind: "op", op })),
    ...draft.recurring.map<Step>((tx) => ({ kind: "recurring", tx })),
  ];
}

/**
 * What is left of the draft after the first `done` steps landed.
 *
 * Called on a partial save as well as a clean one, so a failure halfway keeps
 * exactly the changes that did not happen and drops the ones that did — a
 * retry must not create the same allocation twice.
 *
 * `idMap` carries the real ids the server issued for sub-lines added during
 * this run. Ops still waiting may name a local one as their target or their
 * parent, so they are rewritten through it; otherwise the retry would ask the
 * server to nest under an id it has never seen.
 */
export function afterSave(
  draft: Draft,
  steps: readonly Step[],
  done: number,
  idMap: Readonly<Record<string, string>>,
): Draft {
  const landed = steps.slice(0, done);
  const doneAmounts = new Set(
    landed.filter((s) => s.kind === "amount").map((s) => s.id),
  );
  const doneRemovals = new Set(
    landed.filter((s) => s.kind === "remove").map((s) => s.id),
  );
  const doneCreates = new Set(
    landed.filter((s) => s.kind === "create").map((s) => s.key),
  );
  // By reference, not by count: `toSteps` drops the ops of an allocation being
  // deleted, so the two lists are not index-for-index.
  const doneOps = new Set(landed.flatMap((s) => (s.kind === "op" ? [s.op] : [])));
  const doneRecurring = new Set(
    landed.flatMap((s) => (s.kind === "recurring" ? [s.tx.id] : [])),
  );
  const removed = new Set(draft.removed);
  const gone = new Set(
    [...doneRemovals].concat(draft.added.map((row) => row.key).filter((k) => removed.has(k))),
  );
  const map = (id: string) => idMap[id] ?? id;

  return {
    // `gone` as well as `done`: the allocation an amount was typed over may
    // have been deleted by an earlier step in this same run. Keeping the entry
    // would make the retry PUT an id the server no longer has — a 404 that
    // stops every later step behind it, for good.
    amounts: Object.fromEntries(
      Object.entries(draft.amounts).filter(
        ([id]) => !doneAmounts.has(id) && !gone.has(id),
      ),
    ),
    // A phantom row's strike-through goes with it: there was never a row on
    // the server for it to describe.
    removed: draft.removed.filter((id) => !gone.has(id)),
    added: draft.added.filter(
      (row) => !doneCreates.has(row.key) && !removed.has(row.key),
    ),
    ops: draft.ops
      .filter((op) => !doneOps.has(op) && !gone.has(op.allocationId))
      .map((op) =>
        op.kind === "add"
          ? { ...op, id: map(op.id), parentId: op.parentId && map(op.parentId) }
          : { ...op, id: map(op.id) },
      ),
    recurring: draft.recurring.filter((tx) => !doneRecurring.has(tx.id)),
  };
}
