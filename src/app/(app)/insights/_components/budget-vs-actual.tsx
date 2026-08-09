"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import type { I18n } from "@/lib/i18n/translate";
import { useInsights } from "@/hooks/use-insights";
import { toIsoDate } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const CHART_HEIGHT = 200;
const TICK_COUNT = 4;

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

function monthLabel(i18n: I18n, month: string): string {
  const [y, m] = month.split("-").map(Number);
  return i18n.formatMonthShort(new Date(y, m - 1, 1));
}

interface BudgetVsActualProps {
  planName: string;
  /** The plan whose accounts (and transfer rules) scope the series. */
  budgetId: string;
  /** The plan's current monthly budget (fixed costs + allocations). */
  monthlyBudget: number;
}

/**
 * Monthly spending of the plan's accounts against its current total budget.
 * Fixed 12-month window on purpose — the page's date preset would reduce this
 * to a single bar most of the time.
 */
export function BudgetVsActual({
  planName,
  budgetId,
  monthlyBudget,
}: BudgetVsActualProps) {
  const i18n = useI18n();
  const { t, formatCurrency } = i18n;
  const now = new Date();
  const from = toIsoDate(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  const to = toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const { data, isLoading } = useInsights({ dateFrom: from, dateTo: to, budgetId });
  const [hovered, setHovered] = useState<string | null>(null);

  const months = data?.monthlyTotals ?? [];
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const maxValue = niceMax(
    Math.max(monthlyBudget, ...months.map((m) => m.expenses)),
  );
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) =>
    Math.round((maxValue / TICK_COUNT) * i),
  ).reverse();
  const budgetPct = maxValue > 0 ? (monthlyBudget / maxValue) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("insights.vsActual.title")}</CardTitle>
        <CardDescription>
          {t("insights.vsActual.description", {
            name: planName,
            amount: formatCurrency(monthlyBudget),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-[200px] w-full" />
        ) : months.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("insights.vsActual.empty")}
          </p>
        ) : (
          <div className="flex gap-2">
            {/* Y axis */}
            <div
              className="flex flex-col justify-between text-right text-[10px] text-muted-foreground tabular-nums"
              style={{ height: CHART_HEIGHT }}
              aria-hidden="true"
            >
              {ticks.map((tick) => (
                <span key={tick}>{formatTick(tick)}</span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative" style={{ height: CHART_HEIGHT }}>
                {/* Gridlines */}
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className="absolute inset-x-0 border-t border-border/50"
                    style={{
                      bottom: `${maxValue > 0 ? (tick / maxValue) * 100 : 0}%`,
                    }}
                    aria-hidden="true"
                  />
                ))}
                {/* Budget reference line, direct-labeled */}
                {monthlyBudget > 0 && (
                  <div
                    className="absolute inset-x-0 z-10 border-t-2 border-dashed border-foreground/60"
                    style={{ bottom: `${budgetPct}%` }}
                  >
                    <span className="absolute right-0 -top-4 rounded bg-background/80 px-1 text-[10px] font-medium text-foreground">
                      {t("insights.vsActual.budgetLine")}
                    </span>
                  </div>
                )}
                {/* Bars */}
                <div className="absolute inset-0 flex items-end gap-[2px]">
                  {months.map((m) => {
                    const over = monthlyBudget > 0 && m.expenses > monthlyBudget;
                    const pct =
                      maxValue > 0 ? (m.expenses / maxValue) * 100 : 0;
                    const isHovered = hovered === m.month;
                    const isCurrent = m.month === currentMonth;
                    return (
                      <div
                        key={m.month}
                        className="group relative flex-1"
                        style={{ height: "100%" }}
                        onMouseEnter={() => setHovered(m.month)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <div
                          className={`absolute inset-x-0 bottom-0 rounded-t-[4px] transition-colors ${
                            over
                              ? isHovered
                                ? "bg-red-600"
                                : "bg-red-500/80"
                              : isHovered
                                ? "bg-primary"
                                : isCurrent
                                  ? "bg-primary/60"
                                  : "bg-primary/80"
                          }`}
                          style={{ height: `${pct}%` }}
                        />
                        {isHovered && (
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md">
                            <span className="font-medium">
                              {monthLabel(i18n, m.month)}
                            </span>{" "}
                            <span className="tabular-nums">
                              {formatCurrency(m.expenses)}
                            </span>
                            {monthlyBudget > 0 && (
                              <span
                                className={`ml-1 tabular-nums ${
                                  over
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {over
                                  ? t("insights.vsActual.over", {
                                      amount: formatCurrency(m.expenses - monthlyBudget),
                                    })
                                  : t("insights.vsActual.under", {
                                      amount: formatCurrency(monthlyBudget - m.expenses),
                                    })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* X labels */}
              <div className="mt-1 flex gap-[2px] text-[10px] text-muted-foreground">
                {months.map((m) => (
                  <span key={m.month} className="flex-1 truncate text-center">
                    {monthLabel(i18n, m.month)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
