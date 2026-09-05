"use client";

import { SUB_ROW_GRID, SUB_ROW_INDENT } from "../budget-row";
import { DIALOG_INDENT, type Ctx, type RowProps } from "./constants";

/**
 * The category's colour dot, so a sub-line reads as part of the row above it.
 * Page list only — inside the edit dialog every row is the same category.
 */
export function Dot({ ctx, faded }: { ctx: Ctx; faded?: boolean }) {
  if (ctx.variant !== "list") return null;
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${faded ? "opacity-40" : ""}`}
      style={{ backgroundColor: ctx.color || "#94a3b8" }}
    />
  );
}

/**
 * A row of the list that isn't a sub-line itself: the leftover, the
 * over-allocated warning, the inline editor, the add affordance.
 *
 * In the page list it borrows the sub-row grid so its dot and its figure land
 * in the same two columns every other row uses (see `SubRow`). `full` opts out
 * for the rows that are one wide thing rather than a name and an amount — a
 * form, an error — since a four-track grid has nothing to offer those.
 * In the dialog it stays a plain flex line: nothing above it to line up with.
 */
export function Row({ ctx, depth, full, className = "", children }: RowProps) {
  if (ctx.variant === "list") {
    const indent = SUB_ROW_INDENT[depth - 1] ?? SUB_ROW_INDENT[0];
    const cls = full
      ? `flex items-center gap-2 py-1.5 pr-4 ${indent} ${className}`
      : `${SUB_ROW_GRID} ${indent} ${className}`;
    return <li className={cls}>{children}</li>;
  }
  const indent = DIALOG_INDENT[depth - 1];
  return (
    <div className={`flex items-center gap-2 py-1.5 ${indent} ${className}`}>
      {children}
    </div>
  );
}
