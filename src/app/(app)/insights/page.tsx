"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Landmark,
  Loader2,
} from "lucide-react";
import { useInsights, useBalanceTimeline } from "@/hooks/use-insights";
import { useAccounts } from "@/hooks/use-accounts";
import { useBudgets } from "@/hooks/use-budgets";
import { usePreferences } from "@/hooks/use-preferences";
import {
  getFinancialMonthRange,
  getPreviousFinancialMonth,
} from "@/lib/financial-month";
import { BalanceChart } from "./_components/balance-chart";
import { SpendingByPeriod } from "./_components/spending-by-period";
import { BudgetPerformance } from "./_components/budget-performance";
import type { InsightsData } from "@/types/api";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

type PresetKey = "this_month" | "last_month" | "this_year" | "last_3_months" | "all" | "custom";

const PRESET_TO_TX_PERIOD: Partial<Record<PresetKey, string>> = {
  this_month: "this-month",
  last_month: "last-month",
  last_3_months: "last-3-months",
  this_year: "this-year",
};

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getPresetRange(preset: PresetKey, startDay: number): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "this_month":
      return getFinancialMonthRange(now, startDay);
    case "last_month":
      return getPreviousFinancialMonth(now, startDay);
    case "last_3_months":
      return {
        from: toLocalDateString(new Date(y, m - 2, 1)),
        to: toLocalDateString(new Date(y, m + 1, 0)),
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

const VALID_PRESETS = new Set<PresetKey>([
  "this_month",
  "last_month",
  "last_3_months",
  "this_year",
  "all",
  "custom",
]);

function parsePreset(value: string | null): PresetKey {
  return value && VALID_PRESETS.has(value as PresetKey) ? (value as PresetKey) : "this_month";
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// Simple bar component
function Bar({
  value,
  maxValue,
  color,
  label,
  amount,
  onClick,
}: {
  value: number;
  maxValue: number;
  color: string;
  label: string;
  amount: string;
  onClick?: () => void;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const clickable = Boolean(onClick);
  return (
    <div
      className={`flex items-center gap-3 rounded-md -mx-2 px-2 py-1 ${clickable ? "cursor-pointer hover:bg-muted/60 transition-colors" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
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

const ALL_ACCOUNTS = "__all__";

export default function InsightsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: prefs } = usePreferences();
  const startDay = prefs?.financialMonthStartDay ?? 1;
  const usingFinancialMonth = startDay !== 1;

  const [preset, setPreset] = useState<PresetKey>(() => parsePreset(searchParams.get("preset")));
  const [customDateFrom, setCustomDateFrom] = useState<string>(
    () => searchParams.get("dateFrom") || "",
  );
  const [customDateTo, setCustomDateTo] = useState<string>(
    () => searchParams.get("dateTo") || "",
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => searchParams.get("account") || ALL_ACCOUNTS,
  );

  // Apply the user's default account on first load when the URL didn't pin
  // one. After this runs once, the user is in control of the selection — even
  // switching to "All accounts" must not get overridden by the default.
  const hadInitialAccountParam = useRef(searchParams.get("account") !== null);
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (defaultApplied.current) return;
    if (!prefs) return;
    defaultApplied.current = true;
    if (hadInitialAccountParam.current) return;
    if (prefs.defaultAccountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- One-shot sync from async-loaded prefs; can't derive during render because user must still be able to override.
      setSelectedAccountId(prefs.defaultAccountId);
    }
  }, [prefs]);

  // Non-custom presets are derived; custom uses user-controlled state.
  const computedRange = preset === "custom" ? null : getPresetRange(preset, startDay);
  const dateFrom = computedRange ? computedRange.from : customDateFrom;
  const dateTo = computedRange ? computedRange.to : customDateTo;

  // Sync filter state back into the URL so a back-nav restores the same view.
  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "this_month") params.set("preset", preset);
    if (selectedAccountId !== ALL_ACCOUNTS) params.set("account", selectedAccountId);
    if (preset === "custom") {
      if (customDateFrom) params.set("dateFrom", customDateFrom);
      if (customDateTo) params.set("dateTo", customDateTo);
    }
    const qs = params.toString();
    router.replace(qs ? `/insights?${qs}` : "/insights", { scroll: false });
  }, [preset, selectedAccountId, customDateFrom, customDateTo, router]);

  const { data: accountsData } = useAccounts();
  const accountIdParam =
    selectedAccountId === ALL_ACCOUNTS ? undefined : selectedAccountId;
  const selectedAccount = accountsData?.find((a) => a.id === accountIdParam);
  const accountLabel = selectedAccount ? selectedAccount.name : "All accounts";

  const { data, isLoading } = useInsights({
    dateFrom,
    dateTo,
    accountId: accountIdParam,
  });
  const { data: balanceData, isLoading: balanceLoading } = useBalanceTimeline({
    accountId: accountIdParam,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    forecastMonths: 3,
  });
  const { data: budgetData } = useBudgets({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    accountId: accountIdParam,
  });

  const handlePresetChange = (value: string) => {
    const key = value as PresetKey;
    if (key === "custom") {
      // Seed custom inputs with the previously-shown range so they aren't blank.
      const range = preset === "custom" ? null : getPresetRange(preset, startDay);
      if (range) {
        setCustomDateFrom(range.from);
        setCustomDateTo(range.to);
      }
    }
    setPreset(key);
  };

  const navigateToTransactions = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
    if (accountIdParam) params.set("account", accountIdParam);
    const mappedPeriod = PRESET_TO_TX_PERIOD[preset];
    // When a financial month is active, the transactions page's "this-month"/"last-month"
    // shortcut still means calendar months, so pass explicit dates instead.
    const usePeriodShortcut = mappedPeriod && !(usingFinancialMonth && (preset === "this_month" || preset === "last_month"));
    if (usePeriodShortcut) {
      params.set("period", mappedPeriod);
    } else if (preset !== "all") {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
    }
    router.push(`/transactions?${params.toString()}`);
  };

  const navigateToCategory = (categoryId: string | null) => {
    navigateToTransactions(categoryId ? { category: categoryId } : {});
  };

  if (isLoading && !data) {
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
            {usingFinancialMonth && (preset === "this_month" || preset === "last_month") && (
              <span className="ml-2 text-xs">
                · Financial month: {ordinal(startDay)} – {ordinal(startDay === 1 ? 31 : startDay - 1)} of next month
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={selectedAccountId}
            onValueChange={setSelectedAccountId}
          >
            <SelectTrigger className="w-[200px]">
              <Landmark className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
              {accountsData?.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="w-[150px]"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="w-[150px]"
              />
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => navigateToTransactions({ type: "income" })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigateToTransactions({ type: "income" });
            }
          }}
          className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
        <Card
          role="button"
          tabIndex={0}
          onClick={() => navigateToTransactions({ type: "expense" })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigateToTransactions({ type: "expense" });
            }
          }}
          className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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

      {/* Monthly Budget Performance */}
      <BudgetPerformance data={budgetData ?? null} />

      {/* Balance Over Time */}
      <BalanceChart
        data={balanceData}
        isLoading={balanceLoading}
        accountLabel={accountLabel}
      />

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
                    onClick={cat.categoryId ? () => navigateToCategory(cat.categoryId) : undefined}
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
                  className="w-48 h-48 rounded-full mx-auto max-w-full"
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
                    const clickable = Boolean(cat.categoryId);
                    return (
                      <button
                        key={cat.categoryId || "none"}
                        type="button"
                        disabled={!clickable}
                        onClick={clickable ? () => navigateToCategory(cat.categoryId) : undefined}
                        className={`flex items-center gap-2 truncate text-left rounded-sm px-1 -mx-1 py-0.5 ${clickable ? "cursor-pointer hover:bg-muted/60 transition-colors" : "cursor-default"}`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: cat.categoryColor }}
                        />
                        <span className="truncate">{cat.categoryName}</span>
                        <span className="text-muted-foreground ml-auto shrink-0">
                          {pct}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Spending by Period (daily/weekly/monthly toggle) */}
      <SpendingByPeriod
        dailyTotals={data.dailyTotals}
        monthlyTotals={data.monthlyTotals}
      />

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
