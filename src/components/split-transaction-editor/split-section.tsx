"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Split, Pencil } from "lucide-react";
import { useUnsplitTransaction } from "@/hooks/use-transactions";
import type { Category, Transaction } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { SplitEditor } from "./split-editor";
import { SplitRulePrompt } from "./split-rule-prompt";
import { newSplitRow, rowsFromSplits, type SplitRow } from "./split-rows";

type PickerCategory = Pick<Category, "id" | "name" | "color">;

interface SplitSectionProps {
  transaction: Transaction;
  categories: PickerCategory[];
  accountId: string;
  /** Off on someone else's account — rules are the owner's config. */
  canCreateRule: boolean;
  /**
   * Mount straight into the editor, e.g. from the row context menu. Read once,
   * at mount: the caller keys this component on the transaction id, and clears
   * its own flag when the dialog closes, so there is no later flip to react to.
   */
  autoOpen?: boolean;
}

/** The transaction detail dialog's "Split" section: create, view, edit, or unsplit. */
export function SplitSection({
  transaction,
  categories,
  accountId,
  canCreateRule,
  autoOpen,
}: SplitSectionProps) {
  const { t, formatCurrency } = useI18n();
  const [editing, setEditing] = useState(!!autoOpen);
  const [rulePrompt, setRulePrompt] = useState<{ rows: SplitRow[]; totalCents: number } | null>(
    null,
  );
  const unsplit = useUnsplitTransaction();

  const isSplit = transaction.isSplitParent;
  const blockedReason: "pot" | "reimbursed" | null = transaction.groupId
    ? "pot"
    : transaction.reimbursementCount > 0
      ? "reimbursed"
      : null;

  if (editing) {
    const initialRows =
      isSplit && transaction.splits
        ? rowsFromSplits(transaction.splits)
        : [newSplitRow("0.00"), newSplitRow(Math.abs(transaction.amount).toFixed(2))];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Split className="h-4 w-4 text-muted-foreground" />
          {isSplit ? t("tx.split.editButton") : t("tx.split.button")}
        </div>
        <SplitEditor
          transaction={transaction}
          categories={categories}
          accountId={accountId}
          initialRows={initialRows}
          isEdit={isSplit}
          onCancel={() => setEditing(false)}
          onSaved={(rows) => {
            setEditing(false);
            if (!isSplit && canCreateRule) {
              setRulePrompt({ rows, totalCents: Math.round(Math.abs(transaction.amount) * 100) });
            }
          }}
        />
      </div>
    );
  }

  if (isSplit) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Split className="h-4 w-4 text-muted-foreground" />
            {t("tx.split.sectionTitle")}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              {t("tx.split.editButton")}
            </Button>
            <ConfirmDeleteButton
              variant="text"
              className="h-7"
              label={t("tx.split.unsplit")}
              confirmLabel={t("tx.split.unsplit")}
              message={t("tx.split.unsplitConfirm")}
              pending={unsplit.isPending}
              onConfirm={async () => {
                try {
                  await unsplit.mutateAsync(transaction.id);
                } catch (err) {
                  console.error("Failed to unsplit transaction:", err);
                }
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          {(transaction.splits ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{s.categoryName ?? t("tx.bulk.noCategory")}</p>
                {s.description && s.description !== transaction.description && (
                  <p className="truncate text-xs text-muted-foreground">{s.description}</p>
                )}
              </div>
              <span className="font-mono shrink-0 ml-3">{formatCurrency(s.amount)}</span>
            </div>
          ))}
        </div>
        {rulePrompt && (
          <SplitRulePrompt
            rows={rulePrompt.rows}
            totalCents={rulePrompt.totalCents}
            parentDescription={transaction.name || transaction.description}
            onDone={() => setRulePrompt(null)}
          />
        )}
      </div>
    );
  }

  const blockedLabel =
    blockedReason === "pot"
      ? t("tx.split.disabledPot")
      : blockedReason === "reimbursed"
        ? t("tx.split.disabledReimbursed")
        : null;

  const trigger = (
    <Button variant="outline" size="sm" disabled={!!blockedReason} onClick={() => setEditing(true)}>
      <Split className="h-3.5 w-3.5" />
      {t("tx.split.button")}
    </Button>
  );

  if (!blockedLabel) return <div>{trigger}</div>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{blockedLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
