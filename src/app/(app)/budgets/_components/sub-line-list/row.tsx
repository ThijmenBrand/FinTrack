"use client";

import type { ReactNode } from "react";
import { SUB_ROW_GRID, SUB_ROW_INDENT } from "../budget-row";
import type { Ctx } from "./constants";

/** The category's colour dot, so a sub-line reads as part of the row above it. */
export function Dot({ ctx, faded }: { ctx: Ctx; faded?: boolean }) {
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
 * It borrows the sub-row grid so its dot and its figure land in the same two
 * columns every other row uses (see `SubRow`). `full` opts out for the rows
 * that are one wide thing rather than a name and an amount — a form, an error
 * — since a four-track grid has nothing to offer those. Both keep the sub-row
 * indent, so a form opens exactly where the row it replaces sat.
 */
export function Row({
  depth,
  full,
  className = "",
  children,
}: {
  depth: number;
  /** Row-level extras — the hover surface a line row paints, and nothing else. */
  className?: string;
  /** One wide thing (a form, an error) rather than a name and an amount. */
  full?: boolean;
  children: ReactNode;
}) {
  const indent = SUB_ROW_INDENT[depth - 1] ?? SUB_ROW_INDENT[0];
  const cls = full
    ? `flex items-center gap-2 py-1.5 pr-4 ${indent} ${className}`
    : `${SUB_ROW_GRID} ${indent} ${className}`;
  return <li className={cls}>{children}</li>;
}
