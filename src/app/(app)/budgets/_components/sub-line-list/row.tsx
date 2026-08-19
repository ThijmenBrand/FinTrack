"use client";

import { DIALOG_INDENT, LIST_INDENT, type Ctx, type RowProps } from "./constants";

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

/** One row of chrome: <li> in the page's divide-y list, plain div in the dialog. */
export function Row({ ctx, depth, children }: RowProps) {
  const indent = (ctx.variant === "list" ? LIST_INDENT : DIALOG_INDENT)[depth - 1];
  const cls = `flex items-center gap-2 py-1.5 ${indent}${ctx.variant === "list" ? " pr-4" : ""}`;
  return ctx.variant === "list" ? (
    <li className={cls}>{children}</li>
  ) : (
    <div className={cls}>{children}</div>
  );
}
