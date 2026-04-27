"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Granularity = "daily" | "weekly" | "monthly";

interface PeriodEntry {
  key: string;
  label: string;
  expenses: number;
}

interface SpendingByPeriodProps {
  dailyTotals: { date: string; income: number; expenses: number }[];
  monthlyTotals: { month: string; income: number; expenses: number }[];
}

function formatCurrency(amount: number, fractionDigits = 2) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(amount);
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
    .map(([key, value]) => ({
      key,
      label: value.weekStart.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      expenses: value.expenses,
    }));
}

const TICK_COUNT = 5;
const CHART_HEIGHT = 240;

export function SpendingByPeriod({
  dailyTotals,
  monthlyTotals,
}: SpendingByPeriodProps) {
  const [granularity, setGranularity] = useState<Granularity>("monthly");
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
        }));
    }
    if (granularity === "weekly") {
      return aggregateWeekly(
        dailyTotals.map((d) => ({ date: d.date, expenses: d.expenses }))
      ).filter((e) => e.expenses > 0);
    }
    return monthlyTotals
      .filter((m) => m.expenses > 0)
      .map((m) => ({
        key: m.month,
        label: new Date(m.month + "-01").toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        expenses: m.expenses,
      }));
  }, [granularity, dailyTotals, monthlyTotals]);

  const rawMax = entries.length > 0 ? Math.max(...entries.map((e) => e.expenses)) : 0;
  const yMax = niceMax(rawMax);
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < TICK_COUNT; i++) {
      // Top to bottom: yMax → 0
      ticks.push((yMax * (TICK_COUNT - 1 - i)) / (TICK_COUNT - 1));
    }
    return ticks;
  }, [yMax]);

  const total = entries.reduce((s, e) => s + e.expenses, 0);
  const avg = entries.length > 0 ? total / entries.length : 0;
  const granularityNoun =
    granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";

  const labelStride = entries.length <= 14 ? 1 : Math.ceil(entries.length / 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-6 flex-wrap">
        <div>
          <CardTitle className="text-base">Spending by Period</CardTitle>
          {entries.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              <span className="font-semibold text-foreground tabular-nums">
                {formatCurrency(total)}
              </span>
              <span className="mx-1.5 text-muted-foreground/60">·</span>
              <span className="tabular-nums">{formatCurrency(avg)}</span>{" "}
              avg / {granularityNoun}
            </p>
          )}
        </div>
        <Tabs
          value={granularity}
          onValueChange={(v) => setGranularity(v as Granularity)}
        >
          <TabsList>
            <TabsTrigger value="daily">Daily</TabsTrigger>
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
                    {entries.map((entry) => {
                      const heightPct = (entry.expenses / yMax) * 100;
                      const isHovered = hoveredKey === entry.key;
                      const dimmed = hoveredKey !== null && !isHovered;
                      return (
                        <div
                          key={entry.key}
                          className="relative flex-1 min-w-[16px] h-full flex flex-col justify-end cursor-pointer"
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
                                bottom: `calc(${Math.max(heightPct, 0)}% + 8px)`,
                              }}
                            >
                              <div className="relative px-2.5 py-1 rounded-md bg-foreground text-background text-xs font-semibold tabular-nums whitespace-nowrap shadow-lg">
                                {formatCurrency(entry.expenses)}
                                <div className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-45 w-2 h-2 bg-foreground" />
                              </div>
                            </div>
                          )}
                          {/* Bar */}
                          <div
                            className={
                              "w-full rounded-md transition-[background-color,opacity] duration-150 " +
                              (isHovered
                                ? "bg-primary"
                                : dimmed
                                ? "bg-muted-foreground/15"
                                : "bg-primary/30 dark:bg-primary/40")
                            }
                            style={{
                              height: `${Math.max(heightPct, 0.8)}%`,
                              minHeight: "3px",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* X-axis labels */}
                <div className="flex gap-2 mt-3 px-1">
                  {entries.map((entry, i) => {
                    const showLabel = i % labelStride === 0;
                    const isHovered = hoveredKey === entry.key;
                    return (
                      <div
                        key={entry.key}
                        className={
                          "flex-1 min-w-[16px] text-[10px] text-center truncate transition-colors " +
                          (isHovered
                            ? "text-foreground font-medium"
                            : "text-muted-foreground")
                        }
                      >
                        {showLabel || isHovered ? entry.label : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
