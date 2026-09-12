"use client";

import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, StickyNote, Receipt, Split, Pencil, X, Paperclip } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { canSplitImportRow, type PreviewTransaction } from "@/lib/csv-utils";
import { useI18n } from "@/lib/i18n/client";
import { CategoryPicker } from "@/components/category-picker";
import { PotPicker } from "@/components/pot-picker";
import { ImportAttachments } from "@/components/attachment-strip";
import type { TransactionAttachment } from "@/types/api";

export interface ImportCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface ImportPot {
  id: string;
  name: string;
}

// Deliberately different from the shared formatDate: en-US, no year, and
// pinned to noon to dodge DST edge cases in this row-dense import list.
export const ImportTransactionRow = memo(function ImportTransactionRow({
  tx,
  categories,
  pots,
  accountId,
  onCategoryChange,
  onNotesChange,
  onAttachmentsChange,
  onPotChange,
  onToggleReimbursement,
  onEditSplit,
  onRemoveSplit,
  isAutoMatched,
  selected,
  onToggleSelect,
}: {
  tx: PreviewTransaction;
  categories: ImportCategory[];
  pots: ImportPot[];
  accountId: string;
  onCategoryChange: (tempId: string, categoryId: string) => void;
  onNotesChange: (tempId: string, notes: string | null) => void;
  onAttachmentsChange: (
    tempId: string,
    update: (prev: TransactionAttachment[]) => TransactionAttachment[],
  ) => void;
  onPotChange: (tempId: string, groupId: string | null) => void;
  onToggleReimbursement: (tempId: string) => void;
  /** Open the local split editor for this row (proposed or brand new). */
  onEditSplit: (tempId: string) => void;
  onRemoveSplit: (tempId: string) => void;
  isAutoMatched: boolean;
  selected: boolean;
  onToggleSelect: (tempId: string) => void;
}) {
  const { t, plural, formatDayMonth: formatDate } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const isReimbursement = tx.type === "reimbursement";
  const splits = tx.splits?.length ? tx.splits : null;
  // Reimbursement only makes sense for money coming in; a split row owns its
  // money already, so pot and reimbursement are off until the split is removed.
  const canReimburse = (tx.type === "income" || isReimbursement) && !splits;
  const canSplit = canSplitImportRow(tx);
  // Keep the note input visible whenever a note exists so it's never hidden data
  const showNoteInput = noteOpen || !!tx.notes;
  const attachments = tx.attachments ?? [];
  // Same rule for receipts: once a row carries one, the strip stays open so
  // nobody imports a file they can no longer see.
  const showAttachments = attachOpen || attachments.length > 0;

  // The three prior Select variants differed only in trigger styling + label.
  const triggerClass = !tx.categoryId
    ? "h-7 text-xs border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
    : isAutoMatched
      ? "h-7 text-xs border-dashed"
      : "h-7 text-xs";

  const categorySelect = splits ? (
    // The parts below carry the categories — the row itself has none.
    <span className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
      <Split className="h-3 w-3" />
      {t("import.split.partCount", { count: splits.length })}
    </span>
  ) : (
    <CategoryPicker
      categories={categories}
      value={tx.categoryId || null}
      onChange={(v) => onCategoryChange(tx.tempId, v)}
      accountId={accountId}
      className={triggerClass}
      placeholder={tx.categoryId ? undefined : t("csvRow.selectPlaceholder")}
      trailing={
        isAutoMatched ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0 ml-auto" />
        ) : undefined
      }
    />
  );

  return (
    <div className="px-3 py-2 border-b last:border-b-0 hover:bg-muted/30 transition-colors space-y-1.5">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Selection */}
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(tx.tempId)}
          aria-label={t("csvRow.selectTransaction")}
          className="shrink-0"
        />

        {/* Date */}
        <span className="text-xs text-muted-foreground shrink-0 sm:w-16">
          {formatDate(tx.date)}
        </span>

        {/* Name (primary) and description (secondary) */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(
            "text-sm text-left flex-1 min-w-0 cursor-pointer hover:text-foreground/80 transition-colors",
            !expanded && "overflow-hidden"
          )}
          title={expanded ? undefined : (tx.name ? `${tx.name}\n${tx.description}` : tx.description)}
        >
          <span className={cn("block", !expanded && "truncate")}>
            {tx.name || tx.description}
          </span>
          {tx.name && tx.description && tx.description !== tx.name && (
            <span className={cn("block text-xs text-muted-foreground", !expanded && "truncate")}>
              {tx.description}
            </span>
          )}
        </button>

        {/* Amount */}
        <span
          className={`text-sm font-mono font-medium text-right shrink-0 tabular-nums sm:w-24 ${
            isReimbursement || tx.groupId || splits
              ? "text-muted-foreground"
              : tx.amount >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
          }`}
        >
          {tx.amount >= 0 ? "+" : ""}
          {formatCurrency(tx.amount)}
        </span>

        {/* Note toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={tx.notes ? t("csvRow.editNote") : t("csvRow.addNote")}
          title={tx.notes ? t("csvRow.editNote") : t("csvRow.addNote")}
          onClick={() => setNoteOpen((prev) => !prev)}
        >
          <StickyNote
            className={cn(
              "h-3.5 w-3.5",
              tx.notes ? "text-primary" : "text-muted-foreground"
            )}
          />
        </Button>

        {/* Receipt toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={
            attachments.length
              ? t("csvRow.editAttachments")
              : t("csvRow.addAttachment")
          }
          title={
            attachments.length
              ? plural(
                  attachments.length,
                  "attachments.attached.one",
                  "attachments.attached.other",
                )
              : t("csvRow.addAttachment")
          }
          onClick={() => setAttachOpen((prev) => !prev)}
        >
          <Paperclip
            className={cn(
              "h-3.5 w-3.5",
              attachments.length ? "text-primary" : "text-muted-foreground",
            )}
          />
        </Button>

        {/* Split toggle — eligible rows only; spacer keeps columns aligned */}
        {canSplit || splits ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={splits ? t("import.split.edit") : t("tx.split.button")}
            title={splits ? t("import.split.edit") : t("tx.split.button")}
            onClick={() => onEditSplit(tx.tempId)}
          >
            <Split
              className={cn("h-3.5 w-3.5", splits ? "text-primary" : "text-muted-foreground")}
            />
          </Button>
        ) : (
          <span className="w-7 shrink-0" />
        )}

        {/* Pot picker — a split row's money is already allocated to its parts */}
        {splits ? (
          <span className="w-7 shrink-0" />
        ) : (
          <PotPicker
            pots={pots}
            currentId={tx.groupId ?? null}
            onSelect={(potId) => onPotChange(tx.tempId, potId)}
          />
        )}

        {/* Reimbursement toggle — income rows only; spacer keeps columns aligned */}
        {canReimburse ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={
              isReimbursement
                ? t("csvRow.unmarkReimbursement")
                : t("csvRow.markReimbursement")
            }
            title={
              isReimbursement
                ? tx.reimbursesDescription
                  ? t("csvRow.reimbursesClickToUnmark", {
                      description: tx.reimbursesDescription,
                    })
                  : t("csvRow.unmarkReimbursement")
                : t("csvRow.markReimbursement")
            }
            onClick={() => onToggleReimbursement(tx.tempId)}
          >
            <Receipt
              className={cn(
                "h-3.5 w-3.5",
                isReimbursement ? "text-primary" : "text-muted-foreground"
              )}
            />
          </Button>
        ) : (
          <span className="w-7 shrink-0" />
        )}

        {/* Category selector — desktop only, inline */}
        <div className="w-44 shrink-0 hidden sm:block">
          {categorySelect}
        </div>
      </div>

      {/* Note input — aligned with the description column on desktop */}
      {showNoteInput && (
        <div className="sm:pl-[104px]">
          <Input
            defaultValue={tx.notes ?? ""}
            placeholder={t("notes.placeholder")}
            maxLength={500}
            autoFocus={noteOpen}
            className="h-7 text-xs"
            onBlur={(e) => {
              const value = e.target.value.trim();
              onNotesChange(tx.tempId, value || null);
              if (!value) setNoteOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                // Don't let Escape bubble up and close the import dialog
                e.stopPropagation();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      )}

      {/* Receipts — aligned with the note input above it */}
      {showAttachments && (
        <div className="sm:pl-[104px]">
          <ImportAttachments
            accountId={accountId}
            attachments={attachments}
            onChange={(update) => onAttachmentsChange(tx.tempId, update)}
          />
        </div>
      )}

      {/* Split parts — indented beneath the row, like the transactions list */}
      {splits && (
        // pr-4 keeps the part amounts clear of the list's scrollbar
        <div className="ml-4 space-y-1 border-l-2 border-muted-foreground/20 pl-3 pr-4 sm:ml-[104px]">
          {splits.map((part, i) => {
            const cat = categories.find((c) => c.id === part.categoryId);
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Split className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5",
                    cat ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {cat && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: cat.color || "#94a3b8" }}
                    />
                  )}
                  <span className="truncate">{cat?.name ?? t("import.split.noCategory")}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(part.amount)}
                </span>
              </div>
            );
          })}
          <div className="flex gap-1 pt-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => onEditSplit(tx.tempId)}
            >
              <Pencil className="h-3 w-3" />
              {t("import.split.edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => onRemoveSplit(tx.tempId)}
            >
              <X className="h-3 w-3" />
              {t("import.split.remove")}
            </Button>
          </div>
        </div>
      )}

      {/* Category selector — mobile only, full width below */}
      <div className="sm:hidden">
        {categorySelect}
      </div>
    </div>
  );
});
