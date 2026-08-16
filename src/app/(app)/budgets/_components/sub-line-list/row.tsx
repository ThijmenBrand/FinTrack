"use client";

import { DIALOG_INDENT, LIST_INDENT, type RowProps } from "./constants";

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
