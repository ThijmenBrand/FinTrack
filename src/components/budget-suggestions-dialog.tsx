"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, ArrowRight, Plus } from "lucide-react";
import {
  useAcceptBudgetSuggestions,
  useRejectBudgetSuggestions,
} from "@/hooks/use-budgets";

import type { BudgetSuggestion } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { useResetOnChange } from "@/hooks/use-reset-on-change";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: BudgetSuggestion[];
  lookbackMonths: number;
}

export function BudgetSuggestionsDialog({ open, onOpenChange, suggestions, lookbackMonths }: Props) {
  const { t, plural, formatCurrency } = useI18n();
  const accept = useAcceptBudgetSuggestions();
  const reject = useRejectBudgetSuggestions();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Stable identity for the suggestion set: only changes when the actual ids
  // change, so background refetches that return the same items don't wipe the
  // user's typed overrides.
  const suggestionsKey = useMemo(
    () => suggestions.map((s) => s.id).join(","),
    [suggestions],
  );

  useResetOnChange(open ? suggestionsKey : null, () => {
    if (!open) return;
    const sel: Record<string, boolean> = {};
    const ov: Record<string, string> = {};
    for (const s of suggestions) {
      sel[s.id] = true;
      ov[s.id] = String(s.suggestedAmount);
    }
    setSelected(sel);
    setOverrides(ov);
  });

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const allSelected = suggestions.length > 0 && selectedIds.length === suggestions.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const totalSelected = useMemo(() => {
    let sum = 0;
    for (const s of suggestions) {
      if (!selected[s.id]) continue;
      const raw = parseFloat(overrides[s.id] ?? "");
      sum += Number.isFinite(raw) && raw > 0 ? raw : s.suggestedAmount;
    }
    return sum;
  }, [selected, overrides, suggestions]);

  const handleAccept = () => {
    const items = suggestions
      .filter((s) => selected[s.id])
      .map((s) => {
        const raw = parseFloat(overrides[s.id] ?? "");
        const amount = Number.isFinite(raw) && raw > 0 ? raw : s.suggestedAmount;
        return { id: s.id, amount };
      });
    if (items.length === 0) return;
    // Both writes are optimistic — the rows are already off the list behind
    // this dialog — so it closes on the click. `mutate` rather than
    // `mutateAsync`: a failure puts the suggestions back and has no dialog
    // left to report itself in.
    accept.mutate(items);
    onOpenChange(false);
  };

  const handleRejectAll = () => {
    if (suggestions.length === 0) return;
    reject.mutate(suggestions.map((s) => s.id));
    onOpenChange(false);
  };

  const toggleAll = (next: boolean) => {
    const out: Record<string, boolean> = {};
    for (const s of suggestions) out[s.id] = next;
    setSelected(out);
  };

  const isPending = accept.isPending || reject.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-500" />
            {t("budgets.suggestions.title")}
          </DialogTitle>
          <DialogDescription>
            {plural(
              lookbackMonths,
              "budgets.suggestions.description.one",
              "budgets.suggestions.description.other",
            )}
          </DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t("budgets.suggestions.empty")}
          </div>
        ) : (
          <div className="-mx-6 max-h-[55vh] overflow-y-auto px-6">
            <div className="flex items-center gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAll(Boolean(v))}
                aria-label={t("budgets.suggestions.selectAll")}
              />
              <span className="flex-1">{t("common.category")}</span>
              <span className="w-24 text-right">{t("budgets.suggestions.colCurrent")}</span>
              <span className="w-6" />
              <span className="w-28 text-right">{t("budgets.suggestions.colSuggested")}</span>
            </div>
            <ul className="divide-y">
              {suggestions.map((s) => {
                const isNew = s.currentAmount === null;
                const delta = s.currentAmount !== null ? s.suggestedAmount - s.currentAmount : null;
                return (
                  <li key={s.id} className="flex items-center gap-2 py-2">
                    <Checkbox
                      checked={!!selected[s.id]}
                      onCheckedChange={(v) =>
                        setSelected((prev) => ({ ...prev, [s.id]: Boolean(v) }))
                      }
                      aria-label={t("budgets.suggestions.selectOne", {
                        name: s.categoryName ?? t("budgets.suggestions.fallbackName"),
                      })}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.categoryColor || "#94a3b8" }}
                        />
                        <span className="truncate text-sm font-medium">{s.categoryName ?? t("common.uncategorized")}</span>
                        {isNew && (
                          <span className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5">
                            <Plus className="h-3 w-3" />
                            {t("budgets.suggestions.new")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("budgets.suggestions.avgOver", {
                          amount: formatCurrency(s.avgMonthly),
                          months: s.monthsOfData,
                        })}
                      </div>
                    </div>
                    <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">
                      {s.currentAmount !== null ? formatCurrency(s.currentAmount) : "—"}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <div className="w-28">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
                        <Input
                          type="number"
                          step="5"
                          min="0"
                          inputMode="decimal"
                          value={overrides[s.id] ?? ""}
                          onChange={(e) =>
                            setOverrides((prev) => ({ ...prev, [s.id]: e.target.value }))
                          }
                          className="h-8 pl-5 text-right text-sm tabular-nums"
                        />
                      </div>
                      {delta !== null && Math.abs(delta) >= 1 && (
                        <div
                          className={`mt-0.5 text-right text-[10px] tabular-nums ${delta > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                        >
                          {delta > 0 ? "+" : ""}
                          {formatCurrency(delta)}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t pt-2 text-sm">
              <span className="text-muted-foreground">
                {t("budgets.suggestions.selectedCount", { count: selectedIds.length })}
              </span>
              <span className="tabular-nums font-medium">
                {t("budgets.suggestions.totalPerMonth", {
                  amount: formatCurrency(totalSelected),
                })}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handleRejectAll} disabled={isPending || suggestions.length === 0}>
            {t("budgets.dismissAll")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleAccept} disabled={isPending || selectedIds.length === 0}>
            {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {selectedIds.length === 0
              ? t("budgets.suggestions.applyAll")
              : selectedIds.length === 1
                ? t("budgets.suggestions.applyOne")
                : t("budgets.suggestions.applyCount", { count: selectedIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
