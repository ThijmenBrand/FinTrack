"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar, ChevronDown, Landmark, Loader2 } from "lucide-react";
import { useInsights, useBalanceTimeline } from "@/hooks/use-insights";
import { useAccounts } from "@/hooks/use-accounts";
import { useBudgets } from "@/hooks/use-budgets";
import { usePreferences } from "@/hooks/use-preferences";
import { useStatResets } from "@/hooks/use-stat-resets";
import { formatResetDate } from "@/lib/stat-reset-marks";
import {
  getFinancialMonthRange,
  getPreviousFinancialMonth,
} from "@/lib/financial-month";
import { BalanceChart } from "./_components/balance-chart";
import { SpendingByPeriod } from "./_components/spending-by-period";
import { BudgetPerformance } from "./_components/budget-performance";
import { StatStrip } from "./_components/stat-strip";
import { SignalCards } from "./_components/signal-cards";
import { TopSpending } from "./_components/top-spending";
import { CategoryBreakdownCard } from "./_components/category-breakdown-card";
import { daysLeftIn, elapsedDays, formatRangeLabel } from "./_components/period";
import { toIsoDate } from "@/lib/utils";
import { defaultScopeAccountIds } from "@/lib/account-scope";

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

  switch (preset) {
    case "this_month":
      return getFinancialMonthRange(now, startDay);
    case "last_month":
      return getPreviousFinancialMonth(now, startDay);
    case "last_3_months": {
      // Current financial month plus the two before it (calendar months when startDay is 1).
      const current = getFinancialMonthRange(now, startDay);
      const currentStart = new Date(current.from + "T00:00:00");
      const from = toIsoDate(
        new Date(currentStart.getFullYear(), currentStart.getMonth() - 2, currentStart.getDate()),
      );
      return { from, to: current.to };
    }
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

// The preceding range of equal length, for vs-previous deltas. Null when there
// is no meaningful previous period (All Time, incomplete custom range).
function getPreviousRange(
  preset: PresetKey,
  startDay: number,
  from: string,
  to: string,
): { from: string; to: string } | null {
  const now = new Date();
  switch (preset) {
    case "this_month":
      return getPreviousFinancialMonth(now, startDay);
    case "last_month": {
      // The financial month before last: reference a day just before last month's start.
      const lastMonthStart = new Date(
        getPreviousFinancialMonth(now, startDay).from + "T00:00:00",
      );
      lastMonthStart.setDate(lastMonthStart.getDate() - 1);
      return getFinancialMonthRange(lastMonthStart, startDay);
    }
    case "last_3_months": {
      // The 3 financial months immediately before the current 3. `from` is a
      // financial-month start (day <= 28), so shifting 3 calendar months keeps the day.
      const curStart = new Date(from + "T00:00:00");
      const prevEnd = new Date(curStart);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(
        curStart.getFullYear(),
        curStart.getMonth() - 3,
        curStart.getDate(),
      );
      return { from: toIsoDate(prevStart), to: toIsoDate(prevEnd) };
    }
    case "this_year": {
      const y = now.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "custom": {
      if (!from || !to) return null;
      const f = new Date(from + "T00:00:00");
      const t = new Date(to + "T00:00:00");
      const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
      if (days <= 0) return null;
      const prevTo = new Date(f);
      prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setDate(prevFrom.getDate() - days + 1);
      return { from: toIsoDate(prevFrom), to: toIsoDate(prevTo) };
    }
    case "all":
    default:
      return null;
  }
}

const DELTA_LABELS: Record<PresetKey, string | null> = {
  this_month: "vs last month",
  last_month: "vs previous month",
  last_3_months: "vs previous 3 months",
  this_year: "vs last year",
  custom: "vs previous period",
  all: null,
};

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

const LOADING_MESSAGES = [
  "Counting your coffees…",
  "Interrogating your bank statements…",
  "Blaming the weekend…",
  "Following the money…",
  "Doing maths you'd rather not…",
  "Reticulating splines…",
  "Checking if you can afford it…",
  "Rounding up the usual suspects…",
  "Adding up the damage…",
  "Consulting the piggy bank…",
];

function LoadingMessages() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setI((n) => (n + 1) % LOADING_MESSAGES.length),
      1800,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 py-24">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p
        key={i}
        className="text-sm text-muted-foreground animate-in fade-in duration-500"
      >
        {LOADING_MESSAGES[i]}
      </p>
    </div>
  );
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// Saved account selection (per device). Empty array = all accounts.
// Bumped to v2 so a saved single-account selection doesn't shadow the new
// checking-accounts default.
const ACCOUNTS_STORAGE_KEY = "insights-account-selection-v2";

function loadSavedAccountIds(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : null;
  } catch {
    return null;
  }
}

export default function InsightsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: prefs } = usePreferences();
  const { data: resets } = useStatResets();
  const startDay = prefs?.financialMonthStartDay ?? 1;
  const usingFinancialMonth = startDay !== 1;

  const [preset, setPreset] = useState<PresetKey>(() => parsePreset(searchParams.get("preset")));
  const [customDateFrom, setCustomDateFrom] = useState<string>(
    () => searchParams.get("dateFrom") || "",
  );
  const [customDateTo, setCustomDateTo] = useState<string>(
    () => searchParams.get("dateTo") || "",
  );
  // Empty array = all accounts. Init precedence: URL > saved selection > prefs default.
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(() => {
    const param = searchParams.get("account");
    if (param !== null) return param.split(",").filter(Boolean);
    return loadSavedAccountIds() ?? [];
  });

  const { data: accountsData } = useAccounts();

  // Apply the default account scope (the checking accounts, same as the
  // dashboard) on first load when neither the URL nor a saved selection pinned
  // one. After this runs once, the user is in control — even switching to
  // "All accounts" must not get overridden by the default.
  const hadInitialSelection = useRef(
    searchParams.get("account") !== null || loadSavedAccountIds() !== null,
  );
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (defaultApplied.current) return;
    if (!prefs || !accountsData) return;
    defaultApplied.current = true;
    if (hadInitialSelection.current) return;
    const scope = defaultScopeAccountIds(accountsData, prefs.defaultAccountId);
    if (scope.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- One-shot sync from async-loaded prefs/accounts; can't derive during render because user must still be able to override.
      setSelectedAccountIds(scope);
    }
  }, [prefs, accountsData]);

  // Non-custom presets are derived; custom uses user-controlled state.
  const computedRange = preset === "custom" ? null : getPresetRange(preset, startDay);
  const dateFrom = computedRange ? computedRange.from : customDateFrom;
  const dateTo = computedRange ? computedRange.to : customDateTo;

  // Sync filter state back into the URL so a back-nav restores the same view,
  // and save the account selection so the next visit starts from it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "this_month") params.set("preset", preset);
    if (selectedAccountIds.length > 0)
      params.set("account", selectedAccountIds.join(","));
    if (preset === "custom") {
      if (customDateFrom) params.set("dateFrom", customDateFrom);
      if (customDateTo) params.set("dateTo", customDateTo);
    }
    const qs = params.toString();
    router.replace(qs ? `/insights?${qs}` : "/insights", { scroll: false });
    window.localStorage.setItem(
      ACCOUNTS_STORAGE_KEY,
      JSON.stringify(selectedAccountIds),
    );
  }, [preset, selectedAccountIds, customDateFrom, customDateTo, router]);

  const accountIdParam =
    selectedAccountIds.length > 0 ? selectedAccountIds.join(",") : undefined;
  const accountLabel =
    selectedAccountIds.length === 0
      ? "All accounts"
      : selectedAccountIds.length === 1
        ? accountsData?.find((a) => a.id === selectedAccountIds[0])?.name ??
          "1 account"
        : `${selectedAccountIds.length} accounts`;

  const toggleAccount = (id: string, checked: boolean) => {
    setSelectedAccountIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const prevRange = getPreviousRange(preset, startDay, dateFrom, dateTo);
  const deltaLabel = DELTA_LABELS[preset];

  const { data, isLoading } = useInsights({
    dateFrom,
    dateTo,
    accountId: accountIdParam,
    prevDateFrom: prevRange?.from,
    prevDateTo: prevRange?.to,
  });
  // Full history: the chart has its own range picker (1M…All) and slices
  // client-side, so it must not be capped by the page's date preset.
  const { data: balanceData, isLoading: balanceLoading } = useBalanceTimeline({
    accountId: accountIdParam,
  });
  // Budget caps are envelope-style (PR #33) and span all accounts, but the
  // spend side respects the page's account filter so every card reflects the
  // same selection. Disable the API's day-based scaling when the range is a
  // single financial month (matches the Budgets page) so the budget total
  // isn't pro-rated below its monthly value.
  const isSingleFinancialMonth =
    preset === "this_month" || preset === "last_month";
  const { data: budgetData } = useBudgets({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    accountId: accountIdParam,
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
    // The transactions page only filters on a single account.
    if (selectedAccountIds.length === 1)
      params.set("account", selectedAccountIds[0]);
    const mappedPeriod = PRESET_TO_TX_PERIOD[preset];
    // When a financial month is active, the transactions page's "this-month"/"last-month"
    // shortcut still means calendar months, so pass explicit dates instead.
    const usePeriodShortcut = mappedPeriod && !(usingFinancialMonth && (preset === "this_month" || preset === "last_month"));
    if (params.has("dateFrom") || params.has("dateTo")) {
      // The caller passed an explicit range (a clicked chart bucket) — it wins
      // over the page preset.
    } else if (usePeriodShortcut) {
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
    return <LoadingMessages />;
  }

  if (!data) return null;

  const sortedBreakdown = [...data.categoryBreakdown].sort(
    (a, b) => b.total - a.total
  );
  const totalExpenses = sortedBreakdown.reduce((s, c) => s + c.total, 0);
  const daysLeft = daysLeftIn(dateTo);
  const unbudgetedCategoryIds = new Set(
    (budgetData?.unbudgetedSpending ?? []).map((c) => c.categoryId),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            {usingFinancialMonth && (preset === "this_month" || preset === "last_month") && (
              <>
                Financial month: {ordinal(startDay)} –{" "}
                {ordinal(startDay === 1 ? 31 : startDay - 1)} of next month ·{" "}
              </>
            )}
            {formatRangeLabel(dateFrom, dateTo)}
            {daysLeft > 0 && ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-start font-normal">
                <Landmark className="mr-2 h-4 w-4" />
                <span className="flex-1 truncate text-left">{accountLabel}</span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setSelectedAccountIds([]);
                }}
              >
                All accounts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {accountsData?.map((acc) => (
                <DropdownMenuCheckboxItem
                  key={acc.id}
                  checked={selectedAccountIds.includes(acc.id)}
                  onCheckedChange={(checked) => toggleAccount(acc.id, checked)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {acc.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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

      {/* Headline numbers */}
      <StatStrip
        income={data.summary.totalIncome}
        expenses={data.summary.totalExpenses}
        net={data.summary.net}
        txCount={data.summary.txCount}
        previous={deltaLabel !== null ? data.previous : null}
        deltaLabel={deltaLabel}
        elapsedDays={elapsedDays(dateFrom, dateTo, data.dailyTotals)}
        onIncomeClick={() => navigateToTransactions({ type: "income" })}
        onExpensesClick={() => navigateToTransactions({ type: "expense" })}
      />

      {/* A comparison that reaches back past the reset would report the reset
          itself as a change in spending, so it's withheld rather than shown. */}
      {data.previousPredatesReset && data.statsCutoff && (
        <p className="-mt-4 text-xs text-muted-foreground">
          No {deltaLabel?.replace(/^vs /, "") ?? "previous period"} comparison —
          that period is before your statistics reset on{" "}
          {formatResetDate(data.statsCutoff)}.
        </p>
      )}

      {/* What needs attention, before any chart asks you to find it yourself */}
      <SignalCards
        data={data}
        budget={isSingleFinancialMonth ? budgetData ?? null : null}
        totalExpenses={totalExpenses}
        onCategoryClick={navigateToCategory}
      />

      {/* Category breakdown (stacked monthly chart + per-category rows) */}
      <CategoryBreakdownCard
        sortedBreakdown={sortedBreakdown}
        totalExpenses={totalExpenses}
        monthlyCategoryTotals={data.monthlyCategoryTotals}
        previousCategoryTotals={data.previous?.categoryTotals ?? null}
        resets={resets ?? []}
        unbudgetedCategoryIds={unbudgetedCategoryIds}
        onCategoryClick={navigateToCategory}
      />

      {/* The two time-series read as a pair, so they sit side by side once
          there's room for both without squashing either. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <SpendingByPeriod
          dailyTotals={data.dailyTotals}
          monthlyTotals={data.monthlyTotals}
          resets={resets ?? []}
          onSelectRange={(from, to) =>
            navigateToTransactions({ dateFrom: from, dateTo: to })
          }
        />
        <BalanceChart
          data={balanceData}
          isLoading={balanceLoading}
          accountLabel={accountLabel}
          resets={resets ?? []}
        />
      </div>

      {/* Monthly Budget Performance — only for single financial months; the
          API pro-rates caps for other ranges, which misleads here. */}
      {isSingleFinancialMonth && (
        <BudgetPerformance
          data={budgetData ?? null}
          accountLabel={accountIdParam !== undefined ? accountLabel : undefined}
        />
      )}

      <TopSpending
        merchants={data.topMerchants}
        totalExpenses={totalExpenses}
      />
    </div>
  );
}
