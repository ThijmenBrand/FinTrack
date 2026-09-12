"use client";

import type { BudgetSuggestion } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { Sparkles, X, Check } from "lucide-react";
import { ROW_SHELL, ROW_TWIST, ROW_CHEVRON, ROW_ASIDE, TONE_TEXT } from "./budget-row";

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
    // The sparkle takes the chevron's slot rather than adding one of its own:
    // it says at a glance that this row was proposed, not planned, and the
    // names below it still line up with every other row in the list.
    <li className={`${ROW_SHELL} bg-blue-50/60 dark:bg-blue-950/25`}>
      <span className={ROW_TWIST}>
        <Sparkles
          className={`${ROW_CHEVRON} text-blue-600 dark:text-blue-300`}
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: suggestion.categoryColor || "#3b82f6" }}
          />
          <span className="truncate text-sm font-medium sm:text-[0.9375rem]">
            {suggestion.categoryName}
          </span>
          <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {isNew ? t("budgets.suggestion.new") : t("budgets.suggestion.update")}
          </span>
        </div>
        <div className="ml-4 mt-1 text-xs text-muted-foreground">
          <span>
            {t("budgets.row.avgPerMonth", {
              amount: formatCurrency(suggestion.avgMonthly),
              months: suggestion.monthsOfData,
            })}
          </span>
          {suggestion.currentAmount !== null && (
            <span className="hidden sm:inline">
              {" · "}
              {formatCurrency(suggestion.currentAmount)} →{" "}
              {formatCurrency(suggestion.suggestedAmount)}
              {delta !== null && Math.abs(delta) >= 1 && (
                <span
                  className={`ml-1 ${delta > 0 ? TONE_TEXT.warning : TONE_TEXT.positive}`}
                >
                  ({delta > 0 ? "+" : ""}
                  {formatCurrency(delta)})
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {/* The proposed amount sits in the same column every other row puts its
          budget in, with the two answers it wants directly underneath. */}
      <div className={ROW_ASIDE}>
        <span className="block whitespace-nowrap text-sm font-semibold tabular-nums sm:text-lg">
          {formatCurrency(suggestion.suggestedAmount)}
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            {t("budgets.perMonthShort")}
          </span>
        </span>
        <span className="mt-1.5 flex items-center justify-end gap-1">
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
        </span>
      </div>
    </li>
  );
}
