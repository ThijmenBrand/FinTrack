"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useI18n } from "@/lib/i18n/client";
import { getNextOccurrence } from "@/lib/recurring";
import { Pencil, Repeat, Trash2 } from "lucide-react";
import { FREQ_LABEL_KEYS } from "@/app/(app)/recurring/_components/recurring-item";
import { Dot, Row } from "./row";
import { SubLineForm } from "./sub-line-form";
import { UnlinkConfirm } from "./unlink-confirm";
import { useSubLineError } from "./use-sub-line-error";
import { cents, type Ctx } from "./constants";
import type { LineNode } from "./draft";

export function SubLineRow({
  ctx,
  line,
  depth,
}: {
  ctx: Ctx;
  line: LineNode;
  depth: number;
}) {
  const { t, formatCurrency, formatDayMonth } = useI18n();
  const [editing, setEditing] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const { error, setError, pending, guard } = useSubLineError();
  const { actions } = ctx;

  // Two things can own a line's money instead of the field: the children it
  // adds up from, and the recurring plan it stands for. Either way the number
  // is derived somewhere else and typing over it here would only disagree.
  const lockedHint = line.recurring
    ? t("budgets.subLines.recurringLocked")
    : line.children.length > 0
      ? t("budgets.subLines.derivedTotal")
      : undefined;

  if (editing && actions) {
    return (
      <SubLineForm
        ctx={ctx}
        depth={depth}
        initialName={line.name}
        initialAmount={line.amount}
        lockedHint={lockedHint}
        pending={pending}
        error={error}
        onCancel={() => {
          setError(null);
          setEditing(false);
        }}
        onSubmit={async (name, displayAmount) => {
          const ok = await guard(() =>
            actions.update(
              line.id,
              name,
              lockedHint ? line.amount : ctx.toStored(displayAmount),
            ),
          );
          if (ok) setEditing(false);
        }}
      />
    );
  }

  const remove = () => guard(() => actions?.remove(line));
  // In the dialog the line is the content; in the page list it is a sub-row
  // under the category that already carries the weight.
  const dialog = ctx.variant === "dialog";

  return (
    <>
      <Row
        ctx={ctx}
        depth={depth}
        className={dialog ? "group rounded-md pr-1 transition-colors hover:bg-muted" : ""}
      >
        <Dot ctx={ctx} />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm${dialog ? "" : " text-muted-foreground"}`}
          >
            {line.name}
          </span>
          {/* The plan behind the line, read the way the recurring list reads
              it — this row replaces that one, so it owes the same facts. */}
          {line.recurring && (
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground/70">
              <Repeat className="h-3 w-3 shrink-0" />
              {t("budgets.subLines.nextDue", {
                frequency: t(
                  FREQ_LABEL_KEYS[line.recurring.frequency] ?? "recurring.freq.monthly",
                ),
                date: formatDayMonth(
                  getNextOccurrence(
                    line.recurring.frequency,
                    line.recurring.startDate,
                    line.recurring.dayOfWeek,
                    line.recurring.dayOfMonth,
                    line.recurring.monthOfYear,
                  ),
                ),
              })}
            </span>
          )}
        </span>
        <span
          className={`text-sm tabular-nums${
            dialog ? " font-medium" : " text-muted-foreground"
          }`}
        >
          {formatCurrency(cents(ctx.toDisplay(line.amount)))}
        </span>
        {actions && (
          // Quiet until the row is pointed at, so the column of amounts stays
          // the thing being read. Opacity, not display: the row must not
          // re-flow under the cursor. Touch has no hover, so it keeps them.
          <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:has-[[data-confirming]]:opacity-100">
            {/* Only a plain leaf: a container's money comes from below it, and
                a linked line already has the plan this would create. */}
            {ctx.onMakeRecurring &&
              !line.recurring &&
              line.children.length === 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => ctx.onMakeRecurring?.(line)}
                  aria-label={t("budgets.subLines.makeRecurring")}
                  title={t("budgets.subLines.makeRecurring")}
                >
                  <Repeat className="h-3.5 w-3.5" />
                </Button>
              )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
              aria-label={t("common.edit")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {line.recurring ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => setUnlinking(true)}
                aria-label={t("common.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : (
              // A failed delete has nowhere else to surface — no toast layer.
              <ConfirmDeleteButton
                onConfirm={async () => {
                  await remove();
                }}
                pending={pending}
              />
            )}
          </span>
        )}
      </Row>
      {error && (
        <Row ctx={ctx} depth={depth}>
          <span className="text-xs text-destructive">{error}</span>
        </Row>
      )}
      <UnlinkConfirm
        open={unlinking}
        onOpenChange={setUnlinking}
        name={line.name}
        pending={pending}
        onConfirm={async () => {
          if (await remove()) setUnlinking(false);
        }}
      />
    </>
  );
}
