"use client";

import type { BudgetSuggestion } from "@/types/api";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Sparkles, X, Check } from "lucide-react";

interface SuggestionRowProps {
  suggestion: BudgetSuggestion;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function SuggestionRow({ suggestion, busy, onAccept, onReject }: SuggestionRowProps) {
  const isNew = suggestion.currentAmount === null;
  const delta =
    suggestion.currentAmount !== null
      ? suggestion.suggestedAmount - suggestion.currentAmount
      : null;
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 border-l-2 border-blue-400 bg-blue-50/40 px-4 py-2.5 dark:bg-blue-950/20 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(140px,2fr)_auto_auto]">
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: suggestion.categoryColor || "#3b82f6" }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{suggestion.categoryName}</span>
          <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <Sparkles className="h-2.5 w-2.5" />
            {isNew ? "New" : "Update"}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          avg {formatCurrency(suggestion.avgMonthly)}/mo · {suggestion.monthsOfData} mo
        </div>
      </div>
      <div className="hidden sm:block sm:px-2 text-xs text-muted-foreground">
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
            Suggest{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(suggestion.suggestedAmount)}
            </span>
          </span>
        )}
      </div>
      <div className="text-right tabular-nums text-sm row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto shrink-0">
        <div className="font-medium">{formatCurrency(suggestion.suggestedAmount)}</div>
        <div className="text-xs text-muted-foreground">/mo</div>
      </div>
      <div className="flex items-center gap-1 row-start-1 col-start-3 justify-end sm:row-start-auto sm:col-start-auto">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={onReject}
          disabled={busy}
          aria-label="Dismiss suggestion"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          className="h-7 px-2"
          onClick={onAccept}
          disabled={busy}
          aria-label="Accept suggestion"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
