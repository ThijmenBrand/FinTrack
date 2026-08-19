"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Pause, Pencil, Play, Wallet } from "lucide-react";
import { toMonthly } from "@/lib/recurring";
import type { RecurringTx } from "@/types/api";
import { relativeDay } from "./dates";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
// The budget list's column template. In the budget these rows *are* the plan's
// income and fixed-cost lines, so they have to hit the same tracks as the
// allocations above them — a plan's amount landing in the allocation row's
// delta column was what made that page read as three stacked lists instead of
// one. The cell classes suit both templates; only the tracks differ.
import {
  ROW_GRID as BUDGET_GRID,
  CELL_BAR,
  CELL_AMOUNT,
  CELL_DELTA,
} from "@/app/(app)/budgets/_components/budget-row";

// Standalone page: nothing here draws a progress bar, so there is no bar column
// to hold open and the description takes the room instead.
const OWN_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_9.5rem_5.5rem]";

export const FREQ_LABEL_KEYS: Record<string, MessageKey> = {
  weekly: "recurring.freq.weekly",
  biweekly: "recurring.freq.biweekly",
  monthly: "recurring.freq.monthly",
  yearly: "recurring.freq.yearly",
};

export function RecurringItem({
  item,
  showAccount,
  onEdit,
  onDelete,
  onToggle,
  className = "",
  inBudgetList = false,
}: {
  item: RecurringTx;
  /** Off when every plan is on the same account — the column says nothing then. */
  showAccount: boolean;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
  /** Extra row classes — the budgets page indents these under a category. */
  className?: string;
  /** Line the row up with the budget list's allocation rows. */
  inBudgetList?: boolean;
}) {
  const { t, formatCurrency, formatDayMonth } = useI18n();
  const isIncome = item.type === "income";
  const monthly = toMonthly(item.amount, item.frequency);
  const soon = item.nextOccurrence ? relativeDay(t, item.nextOccurrence) : null;

  return (
    <li
      className={`group transition-colors hover:bg-muted/50 ${inBudgetList ? BUDGET_GRID : OWN_GRID} ${className}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${item.isActive ? "" : "opacity-40"}`}
        style={{ backgroundColor: item.categoryColor || (isIncome ? "#10b981" : "#94a3b8") }}
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${item.isActive ? "" : "text-muted-foreground line-through decoration-muted-foreground/40"}`}
          >
            {item.description}
          </span>
          {!item.isActive && (
            <span className="shrink-0 rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("recurring.paused")}
            </span>
          )}
          {/* Which account gets debited sits on the title line, not the meta
              line: it's the detail that decides whether a plan is affordable,
              and at the end of the meta line it was the first thing to truncate. */}
          {showAccount && item.accountName && (
            <span
              className="flex min-w-0 max-w-[9rem] shrink items-center gap-1 rounded border px-1.5 py-px text-[10px] text-muted-foreground"
              title={`${t("common.account")}: ${item.accountName}`}
            >
              <Wallet className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.accountName}</span>
            </span>
          )}
        </div>
        {/* Frequency and next date first: on a phone the line has room for
            little else, and the trailing detail is what can safely truncate. */}
        <div className="truncate text-xs text-muted-foreground">
          {FREQ_LABEL_KEYS[item.frequency] ? t(FREQ_LABEL_KEYS[item.frequency]) : item.frequency}
          {item.nextOccurrence && (
            <>
              {` · ${t("recurring.next")} `}
              <span className="text-foreground/70">{formatDayMonth(item.nextOccurrence)}</span>
              {soon && <span className="hidden sm:inline"> ({soon})</span>}
            </>
          )}
          {item.categoryName && <span className="hidden sm:inline"> · {item.categoryName}</span>}
        </div>
      </div>

      {/* Holds the bar column open so the amount beside it lands in the same
          track as every other row of the plan. */}
      {inBudgetList && <span className={CELL_BAR} aria-hidden="true" />}

      <div className={`text-right text-xs tabular-nums sm:text-sm ${CELL_AMOUNT}`}>
        <div
          className={`whitespace-nowrap font-medium ${
            !item.isActive
              ? "text-muted-foreground"
              : isIncome
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
          }`}
        >
          {isIncome ? "+" : "−"}
          {formatCurrency(Math.abs(item.amount))}
        </div>
        {/* Non-monthly plans get their monthly equivalent, so the row reconciles
            with the monthly total in the section header above it. */}
        {item.frequency !== "monthly" && (
          <div className="whitespace-nowrap text-xs text-muted-foreground">
            ≈ {formatCurrency(monthly)}
            {t("recurring.perMonthShort")}
          </div>
        )}
      </div>

      {/* Actions stay full-contrast on paused rows — pausing must not dim the
          control that undoes it. */}
      <div
        className={`flex items-center justify-end gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 ${CELL_DELTA}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onToggle(item)}
          aria-label={
            item.isActive
              ? t("recurring.pauseLabel", { name: item.description })
              : t("recurring.resumeLabel", { name: item.description })
          }
          title={item.isActive ? t("recurring.pause") : t("recurring.resume")}
        >
          {item.isActive ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(item)}
          aria-label={t("recurring.editLabel", { name: item.description })}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <ConfirmDeleteButton
          onConfirm={() => onDelete(item.id)}
          label={t("recurring.deleteLabel", { name: item.description })}
        />
      </div>
    </li>
  );
}
