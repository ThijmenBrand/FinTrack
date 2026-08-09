"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import { placeResetMarks } from "@/lib/stat-reset-marks";
import type { StatResetData } from "@/types/api";

interface CategoryBreakdownEntry {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  total: number;
  count: number;
}

interface CategoryBreakdownCardProps {
  /** Sorted descending by total. */
  sortedBreakdown: CategoryBreakdownEntry[];
  totalExpenses: number;
  monthlyCategoryTotals: { month: string; categoryId: string | null; total: number }[];
  /** Keys are categoryId or "none"; null when no previous period was requested. */
  previousCategoryTotals: Record<string, number> | null;
  /** Statistics resets, newest first. The newest one restarts the per-month averages. */
  resets: StatResetData[];
  /** Categories with spending but no budget cap — flagged inline in the list. */
  unbudgetedCategoryIds?: Set<string>;
  onCategoryClick: (categoryId: string | null) => void;
}

const UNCATEGORIZED_COLOR = "#94a3b8";

const catKey = (id: string | null) => id ?? "none";

// Clickable per-category rows with share, count, avg and vs-previous deltas.
export function CategoryBreakdownCard({
  sortedBreakdown,
  totalExpenses,
  monthlyCategoryTotals,
  previousCategoryTotals,
  resets,
  unbudgetedCategoryIds,
  onCategoryClick,
}: CategoryBreakdownCardProps) {
  const { t, formatCurrency } = useI18n();
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const row of monthlyCategoryTotals) {
      if (row.total > 0) set.add(row.month);
    }
    return Array.from(set).sort();
  }, [monthlyCategoryTotals]);

  // The index where the current era begins. Months are keyed "YYYY-MM"; the
  // bucket spans that whole month.
  const activeReset = resets[0] ?? null;
  const eraStart = useMemo(
    () =>
      placeResetMarks(
        months.map((m) => ({ start: `${m}-01`, end: `${m}-31` })),
        resets,
        activeReset?.date ?? null,
      ).find((m) => m.isActive)?.index ?? 0,
    [months, resets, activeReset],
  );

  // Per-category "/mo avg" counts the current era only, so a reset genuinely
  // restarts it instead of averaging two different financial lives together.
  const eraMonths = useMemo(
    () => new Set(months.slice(eraStart)),
    [months, eraStart],
  );
  const eraTotalByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of monthlyCategoryTotals) {
      if (!eraMonths.has(row.month)) continue;
      const key = catKey(row.categoryId);
      map.set(key, (map.get(key) ?? 0) + row.total);
    }
    return map;
  }, [monthlyCategoryTotals, eraMonths]);

  const distinctMonthCount = eraMonths.size;
  const multiMonth = distinctMonthCount > 1;

  const maxCatTotal = sortedBreakdown.length > 0 ? sortedBreakdown[0].total : 1;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("insights.breakdown.title")}</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("insights.breakdown.total", { amount: formatCurrency(totalExpenses) })}
        </span>
      </CardHeader>
      <CardContent>
        {sortedBreakdown.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            {t("insights.topSpending.empty")}
          </p>
        ) : (
          <div className="space-y-1">
            {sortedBreakdown.map((cat) => {
              const clickable = Boolean(cat.categoryId);
              const pct =
                totalExpenses > 0
                  ? ((cat.total / totalExpenses) * 100).toFixed(1)
                  : "0";
              const prev =
                previousCategoryTotals?.[catKey(cat.categoryId)] ?? 0;
              const delta = previousCategoryTotals ? cat.total - prev : null;
              const showDelta = delta !== null && Math.abs(delta) >= 0.5;
              const handleClick = clickable
                ? () => onCategoryClick(cat.categoryId)
                : undefined;
              return (
                <div
                  key={catKey(cat.categoryId)}
                  className={`flex items-center gap-3 rounded-md -mx-2 px-2 py-1.5 ${clickable ? "cursor-pointer hover:bg-muted/60 transition-colors" : ""}`}
                  onClick={handleClick}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleClick?.();
                          }
                        }
                      : undefined
                  }
                >
                  <div
                    className="flex items-center gap-2 w-32 sm:w-44 shrink-0"
                    title={cat.categoryName}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: cat.categoryId
                          ? cat.categoryColor
                          : UNCATEGORIZED_COLOR,
                      }}
                    />
                    <span className="text-sm truncate">{cat.categoryName}</span>
                    {cat.categoryId &&
                      unbudgetedCategoryIds?.has(cat.categoryId) && (
                        // Desktop only — the name column has no room for it
                        // on mobile, where the signal card says the same thing.
                        <span className="hidden shrink-0 rounded-full border border-amber-300 px-1.5 text-[10px] font-semibold text-amber-600 sm:inline dark:border-amber-900/60 dark:text-amber-400">
                          {t("insights.breakdown.noBudgetBadge")}
                        </span>
                      )}
                  </div>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max((cat.total / maxCatTotal) * 100, 1)}%`,
                        backgroundColor: cat.categoryId
                          ? cat.categoryColor
                          : UNCATEGORIZED_COLOR,
                      }}
                    />
                  </div>
                  <div className="text-right shrink-0 w-36 sm:w-48">
                    <div className="text-sm font-medium tabular-nums">
                      {formatCurrency(cat.total)}
                      {showDelta && (
                        <span
                          className={`ml-2 text-xs font-normal ${delta! > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                        >
                          {delta! > 0 ? "▲" : "▼"}{" "}
                          {formatCurrency(Math.abs(delta!))}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {pct}% · {cat.count} tx
                      {multiMonth && (
                        <>
                          {" "}
                          ·{" "}
                          {formatCurrency(
                            (eraTotalByKey.get(catKey(cat.categoryId)) ?? 0) /
                              distinctMonthCount,
                          )}
                          /mo avg{eraStart > 0 && " since reset"}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
