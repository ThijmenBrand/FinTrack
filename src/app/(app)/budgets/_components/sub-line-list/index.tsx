"use client";

import type { Allocation } from "@/types/api";
import { useCreateSubLine, useDeleteSubLine, useUpdateSubLine } from "@/hooks/use-budgets";
import { Container } from "./container";
import type { Ctx, TreeActions } from "./constants";
import type { LineNode } from "./draft";

interface TreeProps {
  lines: LineNode[];
  /** Container cap in stored (monthly) units. */
  cap: number;
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  /** Null renders the tree read-only. */
  actions: TreeActions | null;
  color?: string | null;
  /** "dialog" drops the <li> chrome so the list works inside a modal. */
  variant?: "list" | "dialog";
  onMakeRecurring?: (line: LineNode) => void;
}

/**
 * The tree itself: name + amount rows, no spend tracking. Amounts live in
 * stored (monthly) units; toDisplay/toStored convert at the edges so yearly
 * plans can talk in annual figures.
 *
 * It renders `LineNode`s and calls `actions`, which is all it takes for the
 * add dialog's local draft and a saved allocation to be the same rows: one
 * fills the actions with state updates, the other with API calls.
 */
export function SubLineTree({
  lines,
  cap,
  toDisplay,
  toStored,
  actions,
  color = null,
  variant = "list",
  onMakeRecurring,
}: TreeProps) {
  const ctx: Ctx = { color, toDisplay, toStored, actions, variant, onMakeRecurring };
  return <Container ctx={ctx} lines={lines} cap={cap} parentId={null} depth={1} />;
}

interface SubLineListProps {
  alloc: Allocation;
  /** Container cap in stored (monthly) units = alloc.amount. */
  cap: number;
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  readOnly?: boolean;
  /** "dialog" drops the <li> chrome so the list works inside the edit dialog. */
  variant?: "list" | "dialog";
  /** Offers "make recurring" on leaves; the page list doesn't pass it. */
  onMakeRecurring?: (line: LineNode) => void;
}

/** A saved allocation's split, writing every change straight through its own endpoint. */
export function SubLineList({
  alloc,
  cap,
  toDisplay,
  toStored,
  readOnly = false,
  variant = "list",
  onMakeRecurring,
}: SubLineListProps) {
  const create = useCreateSubLine();
  const update = useUpdateSubLine();
  const del = useDeleteSubLine();

  const actions: TreeActions = {
    add: (parentId, name, amount) =>
      create.mutateAsync({ allocationId: alloc.id, parentId, name, amount }),
    update: (id, name, amount) => update.mutateAsync({ id, name, amount }),
    // Only the sub-line goes; the recurring plan it stood for is left alone,
    // which is what the confirm before this promised.
    remove: (line) => del.mutateAsync(line.id),
  };

  return (
    <SubLineTree
      lines={alloc.subLines}
      cap={cap}
      toDisplay={toDisplay}
      toStored={toStored}
      actions={readOnly ? null : actions}
      color={alloc.categoryColor}
      variant={variant}
      onMakeRecurring={onMakeRecurring}
    />
  );
}
