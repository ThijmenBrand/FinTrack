"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useI18n } from "@/lib/i18n/client";
import { getNextOccurrence } from "@/lib/recurring";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { PausedBadge, PlanMeta, SubRow } from "../sub-row";
import { Row } from "./row";
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
      {error && (
        <Row depth={depth} full>
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
