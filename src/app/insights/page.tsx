"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Calendar,
  Loader2,
} from "lucide-react";

interface CategoryBreakdown {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  total: number;
  count: number;
}

interface MonthlyTotal {
  month: string;
  income: number;
  expenses: number;
}

interface TopMerchant {
  description: string;
  total: number;
  count: number;
}

interface InsightsData {
  categoryBreakdown: CategoryBreakdown[];
  dailyTotals: { date: string; income: number; expenses: number }[];
  monthlyTotals: MonthlyTotal[];
  summary: {
    totalIncome: number;
    totalExpenses: number;
    net: number;
    txCount: number;
  };
  topMerchants: TopMerchant[];
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

type PresetKey = "this_month" | "last_month" | "this_year" | "last_3_months" | "all" | "custom";

function getPresetRange(preset: PresetKey): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "this_month":
      return {
        from: new Date(y, m, 1).toISOString().slice(0, 10),
        to: new Date(y, m + 1, 0).toISOString().slice(0, 10),
      };
    case "last_month":
      return {
        from: new Date(y, m - 1, 1).toISOString().slice(0, 10),
        to: new Date(y, m, 0).toISOString().slice(0, 10),
      };
    case "last_3_months":
      return {
        from: new Date(y, m - 2, 1).toISOString().slice(0, 10),
        to: new Date(y, m + 1, 0).toISOString().slice(0, 10),
      };
    case "this_year":
      return {
        from: `${y}-01-01`,
        to: `${y}-12-31`,
      };
    case "all":
    default:
      return { from: "", to: "" };
  }
}

// Simple bar component
function Bar({
  value,
  maxValue,
  color,
  label,
  amount,
}: {
  value: number;
  maxValue: number;
  color: string;
  label: string;
  amount: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-sm truncate text-right" title={label}>
        {label}
      </div>
      <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-24 text-sm text-right font-medium">{amount}</div>
    </div>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<PresetKey>("this_month");
  const [dateFrom, setDateFrom] = useState(() => getPresetRange("this_month").from);
  const [dateTo, setDateTo] = useState(() => getPresetRange("this_month").to);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await fetch(`/api/insights?${params.toString()}`);
      if (!res.ok) throw new Error("API error");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch insights:", err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handlePresetChange = (value: string) => {
    const key = value as PresetKey;
    setPreset(key);
    if (key === "custom") return;
    const range = getPresetRange(key);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const sortedBreakdown = [...data.categoryBreakdown].sort(
    (a, b) => b.total - a.total
  );
  const maxCatTotal =
    sortedBreakdown.length > 0 ? sortedBreakdown[0].total : 1;
  const totalExpenses = sortedBreakdown.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Insights</h1>
          <p className="text-muted-foreground">
            Visual breakdowns of your spending.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={preset} onValueChange={handlePresetChange}>
            <SelectTrigger className="w-[160px]">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="last_3_months">Last 3 Months</SelectItem>
              <SelectItem value="this_year">This Year</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[150px]"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[150px]"
              />
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(data.summary.totalIncome)}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.summary.txCount} transactions in period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500 dark:text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCurrency(data.summary.totalExpenses)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${data.summary.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
            >
              {data.summary.net >= 0 ? "+" : ""}
              {formatCurrency(data.summary.net)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Spending by Category - Pie-style horizontal bar */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Spending by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedBreakdown.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">
                No expense data for this period.
              </p>
            ) : (
              <div className="space-y-2">
                {sortedBreakdown.map((cat) => (
                  <Bar
                    key={cat.categoryId || "none"}
                    value={cat.total}
                    maxValue={maxCatTotal}
                    color={cat.categoryColor}
                    label={cat.categoryName}
                    amount={formatCurrency(cat.total)}
                  />
                ))}
                <div className="border-t pt-2 mt-3 flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(totalExpenses)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pie Chart (CSS-based) */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Category Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedBreakdown.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">
                No expense data for this period.
              </p>
            ) : (
              <div className="flex flex-col items-center gap-6">
                {/* CSS Conic Gradient Pie Chart */}
                <div
                  className="w-48 h-48 rounded-full"
                  style={{
                    background: (() => {
                      let cumulative = 0;
                      const stops = sortedBreakdown.map((cat) => {
                        const pct = totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0;
                        const start = cumulative;
                        cumulative += pct;
                        return `${cat.categoryColor} ${start}% ${cumulative}%`;
                      });
                      return `conic-gradient(${stops.join(", ")})`;
                    })(),
                  }}
                />
                {/* Legend */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm w-full">
                  {sortedBreakdown.map((cat) => {
                    const pct =
                      totalExpenses > 0
                        ? ((cat.total / totalExpenses) * 100).toFixed(1)
                        : "0";
                    return (
                      <div
                        key={cat.categoryId || "none"}
                        className="flex items-center gap-2 truncate"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: cat.categoryColor }}
                        />
                        <span className="truncate">{cat.categoryName}</span>
                        <span className="text-muted-foreground ml-auto shrink-0">
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Income vs Expenses Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Income vs Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {data.monthlyTotals.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No data for this period.
            </p>
          ) : (
            <div className="space-y-1">
              {(() => {
                const maxVal = Math.max(
                  ...data.monthlyTotals.map((m) =>
                    Math.max(m.income, m.expenses)
                  ),
                  1
                );
                return data.monthlyTotals.map((m) => {
                  const monthLabel = new Date(m.month + "-01").toLocaleDateString(
                    "en-US",
                    { month: "short", year: "numeric" }
                  );
                  return (
                    <div key={m.month} className="space-y-0.5">
                      <div className="flex items-center gap-3">
                        <div className="w-20 text-xs text-right text-muted-foreground">
                          {monthLabel}
                        </div>
                        <div className="flex-1 flex gap-1">
                          {/* Income bar */}
                          <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                            <div
                              className="h-full rounded bg-emerald-500 transition-all duration-500"
                              style={{
                                width: `${(m.income / maxVal) * 100}%`,
                              }}
                            />
                          </div>
                          {/* Expenses bar */}
                          <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                            <div
                              className="h-full rounded bg-red-400 transition-all duration-500"
                              style={{
                                width: `${(m.expenses / maxVal) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="w-36 text-xs flex gap-2 justify-end">
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +{formatCurrency(m.income)}
                          </span>
                          <span className="text-red-500 dark:text-red-400">
                            -{formatCurrency(m.expenses)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
              <div className="flex items-center gap-4 pt-3 text-xs text-muted-foreground justify-center">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Income
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-red-400" /> Expenses
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Merchants */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Spending</CardTitle>
        </CardHeader>
        <CardContent>
          {data.topMerchants.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No expense data for this period.
            </p>
          ) : (
            <div className="space-y-2">
              {data.topMerchants.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1.5 border-b last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                      {i + 1}.
                    </span>
                    <span className="text-sm truncate">{m.description}</span>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <span className="text-sm font-medium">
                      {formatCurrency(m.total)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({m.count}x)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
