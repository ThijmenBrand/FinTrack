"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCreateSubLine } from "@/hooks/use-budgets";
import { useI18n } from "@/lib/i18n/client";
import { Plus } from "lucide-react";
import { Row } from "./row";
import { SubLineForm } from "./sub-line-form";
import { useSubLineError } from "./use-sub-line-error";
import type { Ctx } from "./constants";

export function AddSubLine({
  ctx,
  parentId,
  depth,
  /** The line this one would sit under; absent at the top level. */
  parentName,
}: {
  ctx: Ctx;
  parentId: string | null;
  depth: number;
  parentName?: string;
}) {
  const { t } = useI18n();
  const create = useCreateSubLine();
  const [open, setOpen] = useState(false);
  const { error, setError, guard } = useSubLineError();

  if (!open) {
    return (
      <Row ctx={ctx} depth={depth}>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1 h-3 w-3" />
          {parentName
            ? t("budgets.subLines.addUnder", { name: parentName })
            : t("budgets.subLines.add")}
        </Button>
      </Row>
    );
  }

  return (
    <SubLineForm
      ctx={ctx}
      depth={depth}
      pending={create.isPending}
      error={error}
      onCancel={() => {
        setError(null);
        setOpen(false);
      }}
      onSubmit={async (name, displayAmount) => {
        const ok = await guard(() =>
          create.mutateAsync({
            allocationId: ctx.allocationId,
            parentId,
            name,
            amount: ctx.toStored(displayAmount),
          }),
        );
        if (ok) setOpen(false);
      }}
    />
  );
}
