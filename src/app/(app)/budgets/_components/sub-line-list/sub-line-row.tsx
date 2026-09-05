"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useI18n } from "@/lib/i18n/client";
import { getNextOccurrence } from "@/lib/recurring";
import { Loader2, Pencil, Repeat, Trash2 } from "lucide-react";
import { PausedBadge, PlanMeta, SubRow } from "../sub-row";
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
  const { t, formatCurrency } = useI18n();
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
  // A paused plan owes nothing this month. The standalone plan rows say so and
  // this row stands for one of those, so it says it the same way.
  const paused = line.recurring?.isActive === false;
  const amount = formatCurrency(cents(ctx.toDisplay(line.amount)));

  // Still being written: the row is already on screen but nothing about it can
  // be acted on yet, so the spinner takes the controls' place rather than
  // sitting beside buttons that would edit a line the server has not seen.
  const controls = line.pending ? (
    <Loader2
      className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
      aria-label={t("common.saving")}
    />
  ) : actions ? (
    <>
      {/* Only a plain leaf: a container's money comes from below it, and a
          linked line already has the plan this would create. */}
      {ctx.onMakeRecurring && !line.recurring && line.children.length === 0 && (
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
    </>
  ) : null;

  // The plan behind the line, read the way the standalone plan rows read it —
  // this row replaces one of those, so it owes the same facts in the same words.
  const meta = line.recurring ? (
    <PlanMeta
      frequency={line.recurring.frequency}
      next={getNextOccurrence(
        line.recurring.frequency,
        line.recurring.startDate,
        line.recurring.dayOfWeek,
        line.recurring.dayOfMonth,
        line.recurring.monthOfYear,
      )}
    />
  ) : undefined;

  return (
    <>
      {dialog ? (
        <Row
          ctx={ctx}
          depth={depth}
          className={`group rounded-md pr-1 transition-colors hover:bg-muted${
            line.pending ? " opacity-60" : ""
          }`}
        >
          <Dot ctx={ctx} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{line.name}</span>
            {meta}
          </span>
          <span className="text-sm font-medium tabular-nums">{amount}</span>
          {controls && (
            <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:has-[[data-confirming]]:opacity-100">
              {controls}
            </span>
          )}
        </Row>
      ) : (
        <SubRow
          color={ctx.color}
          depth={depth}
          name={line.name}
          nameSuffix={paused ? <PausedBadge /> : undefined}
          meta={meta}
          amount={amount}
          actions={controls}
          muted={paused}
          pending={line.pending}
        />
      )}
      {error && (
        <Row ctx={ctx} depth={depth} full>
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
