"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { formatResetDate, placeResetMarks } from "@/lib/stat-reset-marks";
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

// Same axis helpers as spending-by-period.tsx — duplicated on purpose to keep
// the two chart files self-contained.
function formatTick(amount: number) {
  if (amount === 0) return "€0";
  if (Math.abs(amount) >= 1000) {
    const k = amount / 1000;
    return `€${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `€${Math.round(amount)}`;
}

// Round up to a "nice" number for an axis upper bound.
function niceMax(max: number): number {
  if (max <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  let nice: number;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (f <= 2.5) nice = 2.5;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}

const TICK_COUNT = 5;
const CHART_HEIGHT = 240;
const TOOLTIP_SLICES = 6;

const catKey = (id: string | null) => id ?? "none";

// Full-width replacement for the old "Spending by Category" + pie duo:
// a stacked per-month chart (when the range spans multiple months) above
// clickable per-category rows with share, count, avg and vs-previous deltas.
export function CategoryBreakdownCard({
  sortedBreakdown,
  totalExpenses,
  monthlyCategoryTotals,
  previousCategoryTotals,
  resets,
  unbudgetedCategoryIds,
  onCategoryClick,
}: CategoryBreakdownCardProps) {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

  const colorByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of sortedBreakdown) {
      map.set(catKey(cat.categoryId), cat.categoryId ? cat.categoryColor : UNCATEGORIZED_COLOR);
    }
    return map;
  }, [sortedBreakdown]);

  const nameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of sortedBreakdown) map.set(catKey(cat.categoryId), cat.categoryName);
    return map;
  }, [sortedBreakdown]);

  // Overall-size rank so stack order is stable across months (largest at bottom).
  const rankByKey = useMemo(() => {
    const map = new Map<string, number>();
    sortedBreakdown.forEach((cat, i) => map.set(catKey(cat.categoryId), i));
    return map;
  }, [sortedBreakdown]);

  const months = useMemo(() => {
    const byMonth = new Map<string, { key: string; total: number }[]>();
    for (const row of monthlyCategoryTotals) {
      if (row.total <= 0) continue;
      const list = byMonth.get(row.month) ?? [];
      list.push({ key: catKey(row.categoryId), total: row.total });
      byMonth.set(row.month, list);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, segments]) => ({
        month,
        label: new Date(month + "-01").toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        total: segments.reduce((s, seg) => s + seg.total, 0),
        // Largest overall category last = rendered at the bottom of the stack.
        segments: [...segments].sort(
          (a, b) => (rankByKey.get(b.key) ?? 0) - (rankByKey.get(a.key) ?? 0),
        ),
      }));
  }, [monthlyCategoryTotals, rankByKey]);

  // Reset boundaries between the monthly bars, and the index where the current
  // era begins. Months are keyed "YYYY-MM"; the bucket spans that whole month.
  const activeReset = resets[0] ?? null;
  const marks = useMemo(
    () =>
      placeResetMarks(
        months.map((m) => ({ start: `${m.month}-01`, end: `${m.month}-31` })),
        resets,
        activeReset?.date ?? null,
      ),
    [months, resets, activeReset],
  );
  const markByIndex = useMemo(
    () => new Map(marks.map((m) => [m.index, m])),
    [marks],
  );
  const eraStart = marks.find((m) => m.isActive)?.index ?? 0;

  // Per-category "/mo avg" counts the current era only, so a reset genuinely
  // restarts it instead of averaging two different financial lives together.
  const eraMonths = useMemo(
    () => new Set(months.slice(eraStart).map((m) => m.month)),
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

  const yMax = niceMax(months.length > 0 ? Math.max(...months.map((m) => m.total)) : 0);
  const yTicks: number[] = [];
  for (let i = 0; i < TICK_COUNT; i++) {
    yTicks.push((yMax * (TICK_COUNT - 1 - i)) / (TICK_COUNT - 1));
  }
  const labelStride = months.length <= 14 ? 1 : Math.ceil(months.length / 10);

  const maxCatTotal = sortedBreakdown.length > 0 ? sortedBreakdown[0].total : 1;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Where your money went</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">
          Total {formatCurrency(totalExpenses)}
        </span>
      </CardHeader>
      <CardContent>
        {sortedBreakdown.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No expense data for this period.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Stacked monthly chart — only meaningful across multiple months */}
            {multiMonth && months.length > 1 && (
              <div className="flex">
                {/* Y-axis */}
                <div
                  className="relative shrink-0 pr-2 w-10"
                  style={{ height: `${CHART_HEIGHT}px` }}
                >
                  {yTicks.map((tick, i) => {
                    const topPct = (i / (yTicks.length - 1)) * 100;
                    return (
                      <span
                        key={i}
                        className="absolute right-2 text-[10px] tabular-nums text-muted-foreground leading-none"
                        style={{ top: `${topPct}%`, transform: "translateY(-50%)" }}
                      >
                        {formatTick(tick)}
                      </span>
                    );
                  })}
                </div>

                {/* Chart area */}
                <div className="flex-1 min-w-0 overflow-x-auto">
                  <div style={{ minWidth: `${Math.max(months.length * 48, 320)}px` }}>
                    <div className="relative" style={{ height: `${CHART_HEIGHT}px` }}>
                      {/* Gridlines */}
                      {yTicks.map((_, i) => {
                        const topPct = (i / (yTicks.length - 1)) * 100;
                        const isBaseline = i === yTicks.length - 1;
                        return (
                          <div
                            key={i}
                            className={
                              isBaseline
                                ? "absolute left-0 right-0 border-t border-border"
                                : "absolute left-0 right-0 border-t border-dashed border-border/60"
                            }
                            style={{ top: `${topPct}%` }}
                          />
                        );
                      })}

                      {/* Stacked bars */}
                      <div className="absolute inset-0 flex items-end gap-2 px-1">
                        {months.map((m, i) => {
                          const heightPct = (m.total / yMax) * 100;
                          const isHovered = hoveredMonth === m.month;
                          const dimmed = hoveredMonth !== null && !isHovered;
                          const isPast = i < eraStart;
                          const mark = markByIndex.get(i);
                          const topSlices = [...m.segments]
                            .sort((a, b) => b.total - a.total)
                            .slice(0, TOOLTIP_SLICES);
                          const otherTotal =
                            m.total - topSlices.reduce((s, seg) => s + seg.total, 0);
                          return (
                            <Fragment key={m.month}>
                            {mark && (
                              <div
                                className={
                                  "relative w-0 shrink-0 self-stretch border-l border-dashed " +
                                  (mark.isActive
                                    ? "border-primary/70"
                                    : "border-muted-foreground/40")
                                }
                              >
                                <span
                                  className={
                                    "absolute top-0 left-1 whitespace-nowrap rounded-sm bg-background/90 px-1 text-[10px] leading-tight " +
                                    (mark.isActive
                                      ? "font-medium text-primary"
                                      : "text-muted-foreground")
                                  }
                                >
                                  {mark.isActive ? "Counting from " : "Reset "}
                                  {formatResetDate(mark.date)}
                                </span>
                              </div>
                            )}
                            <div
                              className={
                                "relative flex-1 min-w-[16px] h-full flex flex-col justify-end cursor-pointer transition-[filter,opacity] " +
                                (isPast && !isHovered
                                  ? "opacity-40 saturate-0"
                                  : "")
                              }
                              onMouseEnter={() => setHoveredMonth(m.month)}
                              onMouseLeave={() =>
                                setHoveredMonth((k) => (k === m.month ? null : k))
                              }
                            >
                              {/* Tooltip */}
                              {isHovered && (
                                <div
                                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-20"
                                  style={{
                                    bottom: `calc(${Math.max(heightPct, 0)}% + 8px)`,
                                  }}
                                >
                                  <div className="relative px-2.5 py-1.5 rounded-md bg-foreground text-background text-xs tabular-nums whitespace-nowrap shadow-lg space-y-0.5">
                                    <div className="font-semibold">
                                      {m.label} · {formatCurrency(m.total)}
                                    </div>
                                    {topSlices.map((seg) => (
                                      <div
                                        key={seg.key}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span
                                          className="h-2 w-2 rounded-sm shrink-0"
                                          style={{
                                            backgroundColor:
                                              colorByKey.get(seg.key) ??
                                              UNCATEGORIZED_COLOR,
                                          }}
                                        />
                                        <span className="opacity-80">
                                          {nameByKey.get(seg.key) ?? "Uncategorized"}
                                        </span>
                                        <span className="ml-auto pl-4 font-medium">
                                          {formatCurrency(seg.total)}
                                        </span>
                                      </div>
                                    ))}
                                    {otherTotal > 0.005 && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 shrink-0" />
                                        <span className="opacity-80">Other</span>
                                        <span className="ml-auto pl-4 font-medium">
                                          {formatCurrency(otherTotal)}
                                        </span>
                                      </div>
                                    )}
                                    <div className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-45 w-2 h-2 bg-foreground" />
                                  </div>
                                </div>
                              )}
                              {/* Stack */}
                              <div
                                className={
                                  "w-full rounded-md overflow-hidden flex flex-col transition-opacity duration-150 " +
                                  (dimmed ? "opacity-25" : "")
                                }
                                style={{
                                  height: `${Math.max(heightPct, 0.8)}%`,
                                  minHeight: "3px",
                                }}
                              >
                                {m.segments.map((seg) => (
                                  <div
                                    key={seg.key}
                                    style={{
                                      height: `${(seg.total / m.total) * 100}%`,
                                      backgroundColor:
                                        colorByKey.get(seg.key) ?? UNCATEGORIZED_COLOR,
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>

                    {/* X-axis labels — zero-width spacers mirror the reset
                        rules above so labels stay aligned with their bars. */}
                    <div className="flex gap-2 mt-3 px-1">
                      {months.map((m, i) => {
                        const showLabel = i % labelStride === 0;
                        const isHovered = hoveredMonth === m.month;
                        return (
                          <Fragment key={m.month}>
                            {markByIndex.has(i) && (
                              <div aria-hidden className="w-0 shrink-0" />
                            )}
                            <div
                              className={
                                "flex-1 min-w-[16px] text-[10px] text-center truncate transition-colors " +
                                (isHovered
                                  ? "text-foreground font-medium"
                                  : i < eraStart
                                  ? "text-muted-foreground/50"
                                  : "text-muted-foreground")
                              }
                            >
                              {showLabel || isHovered ? m.label : ""}
                            </div>
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Category rows */}
            <div className="space-y-1">
              {sortedBreakdown.map((cat) => {
                const clickable = Boolean(cat.categoryId);
                const pct =
                  totalExpenses > 0 ? ((cat.total / totalExpenses) * 100).toFixed(1) : "0";
                const prev = previousCategoryTotals?.[catKey(cat.categoryId)] ?? 0;
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
                            no budget
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
                            {delta! > 0 ? "▲" : "▼"} {formatCurrency(Math.abs(delta!))}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
