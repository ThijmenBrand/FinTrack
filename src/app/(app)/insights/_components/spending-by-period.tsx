"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, toIsoDate } from "@/lib/utils";
import {
  formatResetDate,
  placeResetMarks,
  type ResetMark,
} from "@/lib/stat-reset-marks";
import type { StatResetData } from "@/types/api";

type Granularity = "daily" | "weekly" | "monthly";

interface PeriodEntry {
  key: string;
  label: string;
  expenses: number;
  income?: number;
  /** Inclusive ISO bounds of the bucket, for placing reset markers. */
  start: string;
  end: string;
}

interface SpendingByPeriodProps {
  dailyTotals: { date: string; income: number; expenses: number }[];
  monthlyTotals: { month: string; income: number; expenses: number }[];
  /** Statistics resets, newest first. The newest one dims everything before it. */
  resets: StatResetData[];
  /** Clicking a bucket opens the transactions list for its inclusive date range. */
  onSelectRange: (from: string, to: string) => void;
}

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

// Returns the Monday (ISO week start) for a given date.
function getWeekStart(dateStr: string): Date {
  const dt = new Date(dateStr + "T00:00:00");
  const day = dt.getDay() || 7;
  if (day !== 1) dt.setDate(dt.getDate() - (day - 1));
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// "Jul 6–12" for a same-month week, "Jun 30 – Jul 6" across a month boundary.
function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const startMonth = weekStart.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  if (startMonth === endMonth) {
    return `${startMonth} ${weekStart.getDate()}–${end.getDate()}`;
  }
  return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${end.getDate()}`;
}

function aggregateWeekly(
  daily: { date: string; expenses: number }[]
): PeriodEntry[] {
  const map = new Map<string, { weekStart: Date; expenses: number }>();
  for (const row of daily) {
    if (!row.date) continue;
    const weekStart = getWeekStart(row.date);
    const key = weekStart.toISOString().slice(0, 10);
    const existing = map.get(key);
    const value = row.expenses || 0;
    if (existing) {
      existing.expenses += value;
    } else {
      map.set(key, { weekStart, expenses: value });
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[1].weekStart.getTime() - b[1].weekStart.getTime())
    .map(([key, value]) => {
      const weekEnd = new Date(value.weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return {
        key,
        label: formatWeekRange(value.weekStart),
        expenses: value.expenses,
        start: key,
        end: toIsoDate(weekEnd),
      };
    });
}

/** Last day of the calendar month named by an ISO "YYYY-MM" key. */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return toIsoDate(new Date(y, m, 0));
}

const TICK_COUNT = 5;
const CHART_HEIGHT = 240;

/**
 * Bar fill. Buckets before the active reset drop their meaning-colour and go
 * grey: they are history, not part of the numbers above the chart. Hover still
 * lifts them a step so the tooltip has something to point at.
 */
function barTone(
  hue: "primary" | "emerald",
  state: { isHovered: boolean; dimmed: boolean; isPast: boolean },
): string {
  if (state.isPast) {
    return state.isHovered
      ? "bg-muted-foreground/45"
      : "bg-muted-foreground/20 dark:bg-muted-foreground/25";
  }
  if (state.isHovered) return hue === "emerald" ? "bg-emerald-500" : "bg-primary";
  if (state.dimmed) return "bg-muted-foreground/15";
  return hue === "emerald"
    ? "bg-emerald-500/30 dark:bg-emerald-500/40"
    : "bg-primary/30 dark:bg-primary/40";
}

/**
 * The reset boundary: a zero-width dashed rule that flows between two bars, so
 * it stays glued to the bucket edge no matter how the chart is sized.
 */
function ResetRule({ mark }: { mark: ResetMark }) {
  return (
    <div
      className={
        "relative w-0 shrink-0 self-stretch border-l border-dashed " +
        (mark.isActive ? "border-primary/70" : "border-muted-foreground/40")
      }
    >
      <span
        className={
          "absolute top-0 left-1 whitespace-nowrap rounded-sm bg-background/90 px-1 text-[10px] leading-tight " +
          (mark.isActive ? "font-medium text-primary" : "text-muted-foreground")
        }
      >
        {mark.isActive ? "Counting from " : "Reset "}
        {formatResetDate(mark.date)}
        {mark.note ? ` · ${mark.note}` : ""}
      </span>
    </div>
  );
}

export function SpendingByPeriod({
  dailyTotals,
  monthlyTotals,
  resets,
  onSelectRange,
}: SpendingByPeriodProps) {
  // Long ranges: daily bars get too dense, so hide that tab. Measured on the
  // dailies, since monthlyTotals always spans a trailing year.
  const hideDaily =
    new Set(dailyTotals.map((d) => d.date.slice(0, 7))).size > 3;
  const [rawGranularity, setGranularity] = useState<Granularity>(
    hideDaily ? "monthly" : "weekly"
  );
  // Render-time guard: if new data hid the daily tab while it was selected.
  const granularity =
    hideDaily && rawGranularity === "daily" ? "monthly" : rawGranularity;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const entries: PeriodEntry[] = useMemo(() => {
    if (granularity === "daily") {
      return dailyTotals
        .filter((d) => d.expenses > 0)
        .map((d) => ({
          key: d.date,
          label: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          expenses: d.expenses,
          start: d.date,
          end: d.date,
        }));
    }
    if (granularity === "weekly") {
      return aggregateWeekly(
        dailyTotals.map((d) => ({ date: d.date, expenses: d.expenses }))
      ).filter((e) => e.expenses > 0);
    }
    return monthlyTotals
      .filter((m) => m.income > 0 || m.expenses > 0)
      .map((m) => ({
        key: m.month,
        label: new Date(m.month + "-01").toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        expenses: m.expenses,
        income: m.income,
        start: `${m.month}-01`,
        end: monthEnd(m.month),
      }));
  }, [granularity, dailyTotals, monthlyTotals]);

  // Reset markers, and the index from which the current era begins. Buckets
  // before that index belong to a previous financial life: still plotted, but
  // desaturated, and excluded from the headline average.
  const activeReset = resets[0] ?? null;
  const marks = useMemo(
    () => placeResetMarks(entries, resets, activeReset?.date ?? null),
    [entries, resets, activeReset],
  );
  const eraStart = marks.find((m) => m.isActive)?.index ?? 0;
  const markByIndex = useMemo(
    () => new Map(marks.map((m) => [m.index, m])),
    [marks],
  );

  const showIncome = granularity === "monthly";
  const rawMax =
    entries.length > 0
      ? Math.max(...entries.map((e) => Math.max(e.expenses, e.income ?? 0)))
      : 0;
  const yMax = niceMax(rawMax);
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < TICK_COUNT; i++) {
      // Top to bottom: yMax → 0
      ticks.push((yMax * (TICK_COUNT - 1 - i)) / (TICK_COUNT - 1));
    }
    return ticks;
  }, [yMax]);

  // Headline figures describe the current era only. The pre-reset total is
  // shown separately rather than dropped, so the two still add up to the range.
  const liveEntries = entries.slice(eraStart);
  const total = liveEntries.reduce((s, e) => s + e.expenses, 0);
  const beforeResetTotal = entries
    .slice(0, eraStart)
    .reduce((s, e) => s + e.expenses, 0);
  const avg = liveEntries.length > 0 ? total / liveEntries.length : 0;
  const granularityNoun =
    granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";

  const labelStride = entries.length <= 14 ? 1 : Math.ceil(entries.length / 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-6 flex-wrap">
        <div>
          <CardTitle className="text-base">Spending by Period</CardTitle>
          {entries.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mt-1.5">
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCurrency(total)}
                </span>
                <span className="mx-1.5 text-muted-foreground/60">·</span>
                <span className="tabular-nums">{formatCurrency(avg)}</span>{" "}
                avg / {granularityNoun}
                {/* Monthly reaches past the page's date range, so the total it
                    reports needs to say how far. */}
                {granularity === "monthly" && (
                  <span className="text-muted-foreground/80">
                    {" "}
                    · across {liveEntries.length} month
                    {liveEntries.length === 1 ? "" : "s"}
                  </span>
                )}
                {eraStart > 0 && (
                  <span className="text-muted-foreground/80">
                    {" "}
                    · since your reset
                  </span>
                )}
              </p>
              {eraStart > 0 && (
                <p className="text-xs text-muted-foreground/70 mt-0.5 tabular-nums">
                  {formatCurrency(beforeResetTotal)} before it
                </p>
              )}
            </>
          )}
        </div>
        <Tabs
          value={granularity}
          onValueChange={(v) => setGranularity(v as Granularity)}
        >
          <TabsList>
            {!hideDaily && <TabsTrigger value="daily">Daily</TabsTrigger>}
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No spending in this period.
            </p>
          </div>
        ) : (
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
                    style={{
                      top: `${topPct}%`,
                      transform: "translateY(-50%)",
                    }}
                  >
                    {formatTick(tick)}
                  </span>
                );
              })}
            </div>

            {/* Chart area */}
            <div className="flex-1 min-w-0 overflow-x-auto">
              <div
                style={{
                  minWidth: `${Math.max(entries.length * 40, 320)}px`,
                }}
              >
                <div
                  className="relative"
                  style={{ height: `${CHART_HEIGHT}px` }}
                >
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

                  {/* Bars */}
                  <div className="absolute inset-0 flex items-end gap-2 px-1">
                    {entries.map((entry, i) => {
                      const heightPct = (entry.expenses / yMax) * 100;
                      const incomePct = ((entry.income ?? 0) / yMax) * 100;
                      const isHovered = hoveredKey === entry.key;
                      const dimmed = hoveredKey !== null && !isHovered;
                      const isPast = i < eraStart;
                      const mark = markByIndex.get(i);
                      return (
                        <Fragment key={entry.key}>
                        {mark && <ResetRule mark={mark} />}
                        <button
                          type="button"
                          aria-label={`View transactions for ${entry.label}`}
                          className="relative flex-1 min-w-[16px] h-full flex flex-col justify-end cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => onSelectRange(entry.start, entry.end)}
                          onFocus={() => setHoveredKey(entry.key)}
                          onBlur={() =>
                            setHoveredKey((k) => (k === entry.key ? null : k))
                          }
                          onMouseEnter={() => setHoveredKey(entry.key)}
                          onMouseLeave={() =>
                            setHoveredKey((k) => (k === entry.key ? null : k))
                          }
                        >
                          {/* Tooltip */}
                          {isHovered && (
                            <div
                              className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-20"
                              style={{
                                bottom: `calc(${Math.max(
                                  showIncome
                                    ? Math.max(heightPct, incomePct)
                                    : heightPct,
                                  0
                                )}% + 8px)`,
                              }}
                            >
                              <div className="relative px-2.5 py-1 rounded-md bg-foreground text-background text-xs font-semibold tabular-nums whitespace-nowrap shadow-lg">
                                {showIncome ? (
                                  <span className="flex items-center gap-2">
                                    <span className="text-emerald-400">
                                      +{formatCurrency(entry.income ?? 0)}
                                    </span>
                                    <span className="text-red-400">
                                      −{formatCurrency(entry.expenses)}
                                    </span>
                                  </span>
                                ) : (
                                  formatCurrency(entry.expenses)
                                )}
                                <div className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-45 w-2 h-2 bg-foreground" />
                              </div>
                            </div>
                          )}
                          {/* Bar(s) */}
                          {showIncome ? (
                            <div className="flex items-end gap-0.5 w-full h-full">
                              <div
                                className={
                                  "flex-1 rounded-md transition-[background-color,opacity] duration-150 " +
                                  barTone("emerald", { isHovered, dimmed, isPast })
                                }
                                style={{
                                  height: `${Math.max(incomePct, 0.8)}%`,
                                  minHeight: "3px",
                                }}
                              />
                              <div
                                className={
                                  "flex-1 rounded-md transition-[background-color,opacity] duration-150 " +
                                  barTone("primary", { isHovered, dimmed, isPast })
                                }
                                style={{
                                  height: `${Math.max(heightPct, 0.8)}%`,
                                  minHeight: "3px",
                                }}
                              />
                            </div>
                          ) : (
                            <div
                              className={
                                "w-full rounded-md transition-[background-color,opacity] duration-150 " +
                                barTone("primary", { isHovered, dimmed, isPast })
                              }
                              style={{
                                height: `${Math.max(heightPct, 0.8)}%`,
                                minHeight: "3px",
                              }}
                            />
                          )}
                        </button>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* X-axis labels — reset rules repeat here as zero-width
                    spacers so the labels stay aligned with their bars. */}
                <div className="flex gap-2 mt-3 px-1">
                  {entries.map((entry, i) => {
                    const showLabel = i % labelStride === 0;
                    const isHovered = hoveredKey === entry.key;
                    return (
                      <Fragment key={entry.key}>
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
                          {showLabel || isHovered ? entry.label : ""}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Legend (monthly only) */}
        {showIncome && entries.length > 0 && (
          <div className="flex justify-center gap-4 pt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" />
              Income
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-primary" />
              Expenses
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
