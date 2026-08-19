"use client";

import { useState } from "react";
import type { BudgetSubLine } from "@/types/api";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useDeleteSubLine, useUpdateSubLine } from "@/hooks/use-budgets";
import { useI18n } from "@/lib/i18n/client";
import { Pencil } from "lucide-react";
import { Dot, Row } from "./row";
import { SubLineForm } from "./sub-line-form";
import { useSubLineError } from "./use-sub-line-error";
import { cents, type Ctx } from "./constants";

export function SubLineRow({
  ctx,
  line,
  depth,
}: {
  ctx: Ctx;
  line: BudgetSubLine;
  depth: number;
}) {
  const { t, formatCurrency } = useI18n();
  const update = useUpdateSubLine();
  const del = useDeleteSubLine();
  const [editing, setEditing] = useState(false);
  const { error, setError, guard } = useSubLineError();

  if (editing) {
    return (
      <SubLineForm
        ctx={ctx}
        depth={depth}
        initialName={line.name}
        initialAmount={line.amount}
        pending={update.isPending}
        error={error}
        onCancel={() => {
          setError(null);
          setEditing(false);
        }}
        onSubmit={async (name, displayAmount) => {
          const ok = await guard(() =>
            update.mutateAsync({ id: line.id, name, amount: ctx.toStored(displayAmount) }),
          );
          if (ok) setEditing(false);
        }}
      />
    );
  }

  return (
    <>
      <Row ctx={ctx} depth={depth}>
        <Dot ctx={ctx} />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {line.name}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatCurrency(cents(ctx.toDisplay(line.amount)))}
        </span>
        {!ctx.readOnly && (
          <span className="flex shrink-0 items-center gap-0.5">
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
            {/* A failed delete has nowhere else to surface — no toast layer. */}
            <ConfirmDeleteButton
              onConfirm={async () => {
                await guard(() => del.mutateAsync(line.id));
              }}
              pending={del.isPending}
            />
          </span>
        )}
      </Row>
      {error && (
        <Row ctx={ctx} depth={depth}>
          <span className="text-xs text-destructive">{error}</span>
        </Row>
      )}
    </>
  );
}
