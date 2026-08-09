"use client";

import type { BudgetSuggestion } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { Sparkles, X, Check } from "lucide-react";
import { ROW_GRID, CELL_BAR, CELL_AMOUNT, CELL_DELTA } from "./budget-row";

interface SuggestionRowProps {
  suggestion: BudgetSuggestion;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function SuggestionRow({ suggestion, busy, onAccept, onReject }: SuggestionRowProps) {
  const { t, formatCurrency } = useI18n();
  const isNew = suggestion.currentAmount === null;
  const delta =
    suggestion.currentAmount !== null
      ? suggestion.suggestedAmount - suggestion.currentAmount
      : null;
  return (
    <li className={`bg-blue-50/60 dark:bg-blue-950/25 ${ROW_GRID}`}>
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: suggestion.categoryColor || "#3b82f6" }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{suggestion.categoryName}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <Sparkles className="h-2.5 w-2.5" />
            {isNew ? t("budgets.suggestion.new") : t("budgets.suggestion.update")}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t("budgets.row.avgPerMonth", {
            amount: formatCurrency(suggestion.avgMonthly),
            months: suggestion.monthsOfData,
          })}
        </div>
      </div>
      <div className={`hidden text-xs text-muted-foreground sm:block ${CELL_BAR}`}>
        {suggestion.currentAmount !== null ? (
          <span>
            {formatCurrency(suggestion.currentAmount)} →{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(suggestion.suggestedAmount)}
            </span>
            {delta !== null && Math.abs(delta) >= 1 && (
              <span
                className={`ml-1 ${delta > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
              >
                ({delta > 0 ? "+" : ""}
                {formatCurrency(delta)})
              </span>
            )}
          </span>
        ) : (
          <span>
            {t("budgets.suggestion.suggestPrefix")}{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(suggestion.suggestedAmount)}
            </span>
          </span>
        )}
      </div>
      <div className={`whitespace-nowrap text-right text-sm tabular-nums ${CELL_AMOUNT}`}>
        <span className="font-medium">{formatCurrency(suggestion.suggestedAmount)}</span>
        <span className="text-muted-foreground">{t("budgets.perMonthShort")}</span>
      </div>
      <div className={`flex items-center justify-end gap-1 ${CELL_DELTA}`}>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={onReject}
          disabled={busy}
          aria-label={t("budgets.suggestion.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          className="h-7 px-2"
          onClick={onAccept}
          disabled={busy}
          aria-label={t("budgets.suggestion.accept")}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
