"use client";

import { Fragment } from "react";
import type { BudgetSubLine } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { MONEY_EPSILON } from "@/lib/validation";
import { AddSubLine } from "./add-sub-line";
import { Dot, Row } from "./row";
import { SubLineRow } from "./sub-line-row";
import { MAX_SUB_LINE_DEPTH, cents, type Ctx } from "./constants";

/**
 * One container's rows: each line (plus its own children), the implicit
 * remainder, the over-allocation warning, and the add affordance. The
 * allocation itself is the root container; caps cascade down the tree.
 */
export function Container({
  ctx,
  lines,
  cap,
  parentId,
  parentName,
  depth,
}: {
  ctx: Ctx;
  lines: BudgetSubLine[];
  cap: number;
  parentId: string | null;
  parentName?: string;
  depth: number;
}) {
  const { t, formatCurrency } = useI18n();
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const remainder = cap - total;
  // Adding lives in the edit dialog only; the page list stays read-quiet.
  // Every container offers it, including empty ones — gating nested adds on
  // "already has lines" made levels 2 and 3 unreachable, since the only way to
  // get a first child was a button that first needed a child to appear.
  const showAdd = !ctx.readOnly && ctx.variant === "dialog";

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

      {/* Auto-generate can lower the cap below an existing split. */}
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
          parentId={parentId}
          parentName={parentName}
          depth={depth}
        />
      )}
    </>
  );
}
