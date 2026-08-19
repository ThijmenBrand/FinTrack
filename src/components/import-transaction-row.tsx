"use client";

import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, StickyNote, Receipt } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { PreviewTransaction } from "@/lib/csv-utils";
import { useI18n } from "@/lib/i18n/client";
import { CategoryPicker } from "@/components/category-picker";
import { PotPicker } from "@/components/pot-picker";

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
  onPotChange,
  onToggleReimbursement,
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
  onPotChange: (tempId: string, groupId: string | null) => void;
  onToggleReimbursement: (tempId: string) => void;
  isAutoMatched: boolean;
  selected: boolean;
  onToggleSelect: (tempId: string) => void;
}) {
  const { t, formatDayMonth: formatDate } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const isReimbursement = tx.type === "reimbursement";
  // Reimbursement only makes sense for money coming in
  const canReimburse = tx.type === "income" || isReimbursement;
  // Keep the note input visible whenever a note exists so it's never hidden data
  const showNoteInput = noteOpen || !!tx.notes;

  // The three prior Select variants differed only in trigger styling + label.
  const triggerClass = !tx.categoryId
    ? "h-7 text-xs border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
    : isAutoMatched
      ? "h-7 text-xs border-dashed"
      : "h-7 text-xs";

  const categorySelect = (
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
            isReimbursement || tx.groupId
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

        {/* Pot picker */}
        <PotPicker
          pots={pots}
          currentId={tx.groupId ?? null}
          onSelect={(potId) => onPotChange(tx.tempId, potId)}
        />

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

      {/* Category selector — mobile only, full width below */}
      <div className="sm:hidden">
        {categorySelect}
      </div>
    </div>
  );
});
