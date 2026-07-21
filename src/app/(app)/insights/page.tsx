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
import { Bar } from "./_components/bar";
import { SummaryCard } from "./_components/summary-card";
import { CategoryDistributionCard } from "./_components/category-distribution-card";
import { MonthlyIncomeExpenseChart } from "./_components/monthly-income-expense-chart";
import { formatCurrency, toIsoDate } from "@/lib/utils";
import type { InsightsData } from "@/types/api";

type PresetKey = "this_month" | "last_month" | "this_year" | "last_3_months" | "all" | "custom";

const PRESET_TO_TX_PERIOD: Partial<Record<PresetKey, string>> = {
  this_month: "this-month",
  last_month: "last-month",
  last_3_months: "last-3-months",
  this_year: "this-year",
};

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
        from: toIsoDate(new Date(y, m - 2, 1)),
        to: toIsoDate(new Date(y, m + 1, 0)),
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
  // Budgets are envelope-style (PR #33): they span all accounts, so the
  // Budget Performance card ignores the page's account filter to match the
  // dashboard's Budget Overview. Disable the API's day-based scaling when
  // the range is a single financial month (matches the Budgets page) so
  // the budget total isn't pro-rated below its monthly value.
  const isSingleFinancialMonth =
    preset === "this_month" || preset === "last_month";
  const { data: budgetData } = useBudgets({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    noScale: isSingleFinancialMonth,
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
        <SummaryCard
          type="income"
          amount={data.summary.totalIncome}
          subtitle={`${data.summary.txCount} transactions in period`}
          onClick={() => navigateToTransactions({ type: "income" })}
        />
        <SummaryCard
          type="expense"
          amount={data.summary.totalExpenses}
          onClick={() => navigateToTransactions({ type: "expense" })}
        />
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
      <BudgetPerformance
        data={budgetData ?? null}
        accountFiltered={accountIdParam !== undefined}
      />

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
        <CategoryDistributionCard
          sortedBreakdown={sortedBreakdown}
          totalExpenses={totalExpenses}
          onCategoryClick={navigateToCategory}
        />
      </div>

      {/* Spending by Period (daily/weekly/monthly toggle) */}
      <SpendingByPeriod
        dailyTotals={data.dailyTotals}
        monthlyTotals={data.monthlyTotals}
      />

      {/* Monthly Income vs Expenses Bar Chart */}
      <MonthlyIncomeExpenseChart monthlyTotals={data.monthlyTotals} />

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
