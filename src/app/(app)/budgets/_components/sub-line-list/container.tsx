"use client";

import { Fragment } from "react";
import { useI18n } from "@/lib/i18n/client";
import { MONEY_EPSILON } from "@/lib/validation";
import { AddSubLine } from "./add-sub-line";
import { Dot, Row } from "./row";
import { SubLineRow } from "./sub-line-row";
import { MAX_SUB_LINE_DEPTH, cents, type Ctx } from "./constants";
import type { LineNode } from "./draft";

/**
 * One container's rows: each line (plus its own children), whatever the
 * container has left over, and the add affordance. The allocation itself is
 * the root container.
 *
 * A container now equals its children, so the leftover and over-allocated
 * rows below are only ever reached by an allocation written before roll-up
 * existed — nothing re-sums those on read, deliberately, so the page list has
 * to keep being able to explain the gap.
 */
export function Container({
  ctx,
  lines,
  cap,
  parentId,
  parentName,
  depth,
  parentRecurring = false,
}: {
  ctx: Ctx;
  lines: LineNode[];
  cap: number;
  parentId: string | null;
  parentName?: string;
  depth: number;
  /** The container's line stands for a recurring plan — it can't be split. */
  parentRecurring?: boolean;
}) {
  const { t, formatCurrency } = useI18n();
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const remainder = cap - total;
  // Adding lives in the dialogs only; the page list stays read-quiet. Every
  // container offers it, including empty ones — gating nested adds on "already
  // has lines" made levels 2 and 3 unreachable, since the only way to get a
  // first child was a button that first needed a child to appear.
  // A recurring line's amount comes from its plan, so it cannot also be the
  // sum of children — the tree endpoint refuses that shape. Don't offer what
  // can't be saved.
  const showAdd = ctx.variant === "dialog" && !parentRecurring ? ctx.actions : null;

  return (
    <>
      {lines.map((line) => (
        <Fragment key={line.id}>
          <SubLineRow ctx={ctx} line={line} depth={depth} />
          {depth < MAX_SUB_LINE_DEPTH && (
            <Container
              ctx={ctx}
              lines={line.children}
              cap={line.amount}
              parentId={line.id}
              parentName={line.name}
              depth={depth + 1}
              parentRecurring={Boolean(line.recurring)}
            />
          )}
        </Fragment>
      ))}

      {lines.length > 0 && remainder > MONEY_EPSILON && (
        <Row ctx={ctx} depth={depth}>
          {/* Faded: the remainder is what is left of the category, not a line
              someone named. */}
          <Dot ctx={ctx} faded />
          <span className="min-w-0 flex-1 truncate text-xs italic text-muted-foreground/70">
            {t("budgets.subLines.everythingElse")}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground/70">
            {formatCurrency(cents(ctx.toDisplay(remainder)))}
          </span>
        </Row>
      )}

      {total > cap + MONEY_EPSILON && (
        <Row ctx={ctx} depth={depth}>
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {t("budgets.subLines.overBy", {
              amount: formatCurrency(cents(ctx.toDisplay(total - cap))),
            })}
          </span>
        </Row>
      )}

      {showAdd && (
        <AddSubLine
          ctx={ctx}
          actions={showAdd}
          parentId={parentId}
          parentName={parentName}
          depth={depth}
        />
      )}
    </>
  );
}
