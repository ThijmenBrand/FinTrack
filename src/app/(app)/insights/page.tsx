"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Loader2, Star } from "lucide-react";
import {
  useInsights,
  useBalanceTimeline,
  useMoneyFlow,
} from "@/hooks/use-insights";
import { useBudgets } from "@/hooks/use-budgets";
import { useBudgetPlans } from "@/hooks/use-budget-plans";
import { usePreferences } from "@/hooks/use-preferences";
import { useStatResets } from "@/hooks/use-stat-resets";
import { useI18n } from "@/lib/i18n/client";
import type { I18n, MessageKey } from "@/lib/i18n/translate";
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
import { MoneyFlow } from "./_components/money-flow";
import { daysLeftIn, elapsedDays, formatRangeLabel } from "./_components/period";
import { BudgetVsActual } from "./_components/budget-vs-actual";
import { BudgetComparisonStrip } from "./_components/budget-comparison-strip";
import { SimpleStory } from "./_components/simple-story";
import { toIsoDate } from "@/lib/utils";

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

const DELTA_LABEL_KEYS: Record<PresetKey, MessageKey | null> = {
  this_month: "insights.delta.thisMonth",
  last_month: "insights.delta.lastMonth",
  last_3_months: "insights.delta.last3Months",
  this_year: "insights.delta.thisYear",
  custom: "insights.delta.custom",
  all: null,
};

// Simple mode's sentences name the comparison period instead of labelling a
// delta column, so "vs last month" won't do — it needs "last month".
const PREV_LABEL_KEYS: Record<PresetKey, MessageKey | null> = {
  this_month: "insights.simple.prev.thisMonth",
  last_month: "insights.simple.prev.lastMonth",
  last_3_months: "insights.simple.prev.last3Months",
  this_year: "insights.simple.prev.thisYear",
  custom: "insights.simple.prev.custom",
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

const LOADING_MESSAGES: MessageKey[] = [
  "insights.loading1",
  "insights.loading2",
  "insights.loading3",
  "insights.loading4",
  "insights.loading5",
  "insights.loading6",
  "insights.loading7",
  "insights.loading8",
  "insights.loading9",
  "insights.loading10",
];

function LoadingMessages() {
  const { t } = useI18n();
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
        {t(LOADING_MESSAGES[i])}
      </p>
    </div>
  );
}

// Saved budget-tab selection (per device): "overall" or a plan id. Replaces
// the pre-plans account selection.
const BUDGET_STORAGE_KEY = "insights-budget-selection-v1";
const OVERALL = "overall";

function loadSavedBudgetSelection(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(BUDGET_STORAGE_KEY);
}

export default function InsightsPage() {
  const i18n: I18n = useI18n();
  const { t, plural, formatDate, ordinal } = i18n;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: prefs } = usePreferences();
  const { data: resets } = useStatResets();
  const startDay = prefs?.financialMonthStartDay ?? 1;
  const usingFinancialMonth = startDay !== 1;
  // Simple mode: one view over all accounts — no budget tabs, no deep-dive
  // charts. The saved/URL budget selection is kept but ignored while on.
  const simple = prefs?.simpleMode ?? false;

  const [preset, setPreset] = useState<PresetKey>(() => parsePreset(searchParams.get("preset")));
  const [customDateFrom, setCustomDateFrom] = useState<string>(
    () => searchParams.get("dateFrom") || "",
  );
  const [customDateTo, setCustomDateTo] = useState<string>(
    () => searchParams.get("dateTo") || "",
  );
  // Which view: "overall" or a budget plan id. Init precedence: URL > saved
  // selection > main plan (applied once plans load).
  const [selectedBudget, setSelectedBudget] = useState<string | null>(() => {
    return searchParams.get("budget") ?? loadSavedBudgetSelection();
  });

  const { data: plansData } = useBudgetPlans();
  // Memoised: a fresh [] each render would re-run every effect below it.
  const plans = useMemo(() => plansData?.plans ?? [], [plansData]);

  // Default to the main budget on first load when nothing pinned a view, and
  // recover to it when a saved/linked plan id no longer exists (deleted plan).
  useEffect(() => {
    if (!plansData) return;
    const known =
      selectedBudget === OVERALL ||
      (selectedBudget !== null && plans.some((p) => p.id === selectedBudget));
    if (known) return;
    const main = plans.find((p) => p.isMain) ?? plans[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- One-shot sync from async-loaded plans; user must still be able to override afterwards.
    setSelectedBudget(main ? main.id : OVERALL);
  }, [plansData, plans, selectedBudget]);

  const selectedPlan =
    selectedBudget !== null && selectedBudget !== OVERALL
      ? plans.find((p) => p.id === selectedBudget) ?? null
      : null;
  // Simple mode keeps the switcher (a second budget is useless if you can't
  // reach it) but hides it when there's nothing to switch between.
  const showBudgetTabs = plans.length > 0 && (!simple || plans.length > 1);
  // Which plan the budget-vs-actual chart follows. Simple mode hides the tabs
  // when there's one plan, so an Overall selection (saved from before, or from
  // the full view) would silently drop the chart with no way to get it back.
  const chartPlan =
    selectedPlan ?? (simple ? plans.find((p) => p.isMain) ?? plans[0] ?? null : null);
  // The view's transaction scope: a plan's accounts, or everything on Overall.
  const selectedAccountIds = selectedPlan
    ? selectedPlan.accounts.map((a) => a.id)
    : [];

  // Non-custom presets are derived; custom uses user-controlled state.
  const computedRange = preset === "custom" ? null : getPresetRange(preset, startDay);
  const dateFrom = computedRange ? computedRange.from : customDateFrom;
  const dateTo = computedRange ? computedRange.to : customDateTo;

  // Sync filter state back into the URL so a back-nav restores the same view,
  // and save the budget selection so the next visit starts from it.
  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "this_month") params.set("preset", preset);
    if (selectedBudget !== null) params.set("budget", selectedBudget);
    if (preset === "custom") {
      if (customDateFrom) params.set("dateFrom", customDateFrom);
      if (customDateTo) params.set("dateTo", customDateTo);
    }
    const qs = params.toString();
    router.replace(qs ? `/insights?${qs}` : "/insights", { scroll: false });
    if (selectedBudget !== null) {
      window.localStorage.setItem(BUDGET_STORAGE_KEY, selectedBudget);
    }
  }, [preset, selectedBudget, customDateFrom, customDateTo, router]);

  const accountIdParam =
    selectedAccountIds.length > 0 ? selectedAccountIds.join(",") : undefined;
  const accountLabel = selectedPlan
    ? t("insights.planAccounts", { name: selectedPlan.name })
    : t("insights.allAccounts");

  const prevRange = getPreviousRange(preset, startDay, dateFrom, dateTo);
  const deltaLabelKey = DELTA_LABEL_KEYS[preset];
  const deltaLabel = deltaLabelKey ? t(deltaLabelKey) : null;
  const prevLabelKey = PREV_LABEL_KEYS[preset];

  const { data, isLoading } = useInsights({
    dateFrom,
    dateTo,
    accountId: accountIdParam,
    budgetId: selectedPlan?.id,
    prevDateFrom: prevRange?.from,
    prevDateTo: prevRange?.to,
  });
  const [flowOpen, setFlowOpen] = useState(false);
  const { data: flowData, isLoading: flowLoading } = useMoneyFlow({
    dateFrom,
    dateTo,
    accountId: accountIdParam,
    enabled: flowOpen,
  });
  // Full history: the chart has its own range picker (1M…All) and slices
  // client-side, so it must not be capped by the page's date preset.
  const { data: balanceData, isLoading: balanceLoading } = useBalanceTimeline({
    accountId: accountIdParam,
    enabled: !simple,
  });
  // Budget caps and spend both follow the selected plan (the API scopes to
  // its allocations and its accounts). Disable the API's day-based scaling
  // when the range is a single financial month (matches the Budgets page) so
  // the budget total isn't pro-rated below its monthly value. On Overall the
  // per-category budget view is hidden, so nothing is fetched.
  const isSingleFinancialMonth =
    preset === "this_month" || preset === "last_month";
  const { data: budgetData } = useBudgets({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    budgetId: selectedPlan?.id,
    noScale: isSingleFinancialMonth,
    enabled: !!selectedPlan && !simple,
  });
  // The plan's unscaled monthly budget for the vs-actual chart — independent
  // of the page's date preset. Shown in simple mode too.
  const { data: planMonthlyData } = useBudgets({
    budgetId: chartPlan?.id,
    noScale: true,
    // Simple mode always charts: budget allocations exist without a plan row,
    // and with no budgetId the API totals them across every account.
    enabled: simple || !!chartPlan,
  });

  // The vs-actual chart looks back twelve months, which straddles two
  // financial years on a yearly plan. Only fetch the previous year when there
  // is a yearly envelope to fetch it for.
  //
  // The chart's bars are calendar months (the insights endpoint buckets its
  // dailies by `YYYY-MM`), so a per-month allowance can only be laid over them
  // when a financial month *is* a calendar month. With a custom start day the
  // two windows differ by a few weeks and the marker would be judging January's
  // spend against 25 Jan – 24 Feb's allowance, so the chart falls back to the
  // plan's flat monthly reference instead.
  // ponytail: gated rather than fixed — a financial-month series alongside
  // `monthlyTotals` is the upgrade path, and `spending-by-period` still wants
  // the calendar one.
  const chartIsYearly =
    planMonthlyData?.plan?.period === "yearly" && startDay === 1;
  const previousYear = (planMonthlyData?.yearly?.year ?? 0) - 1;
  const { data: previousYearData } = useBudgets({
    budgetId: chartPlan?.id,
    noScale: true,
    year: previousYear,
    enabled: chartIsYearly && previousYear > 0,
  });

  // Each month's real ceiling: the categories' carry-over-adjusted allowances
  // plus the plan's recurring fixed costs, which sit outside the envelope.
  const allowanceByMonth = useMemo(() => {
    if (!chartIsYearly) return undefined;
    const fixed = planMonthlyData?.totalFixedCosts ?? 0;
    const out: Record<string, number> = {};
    for (const view of [previousYearData?.yearly, planMonthlyData?.yearly]) {
      if (!view) continue;
      for (const category of view.categories) {
        for (const month of category.months) {
          const key = month.from.slice(0, 7);
          // Floored: a category that already spent its pot has a negative
          // allowance, which is a debt to later months, not a licence for
          // the others to overspend by that much.
          out[key] = (out[key] ?? fixed) + Math.max(0, month.allowance);
        }
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [chartIsYearly, planMonthlyData, previousYearData]);

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
    // The transactions page only filters on a single account. A caller that
    // named one (a money-flow leg belongs to one account) wins.
    if (!params.has("account") && selectedAccountIds.length === 1)
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

  // A budget with no accounts has no spending to analyze — showing all-account
  // numbers under its tab would be a lie. Prompt instead.
  if (selectedPlan && selectedPlan.accounts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("insights.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("insights.planBudget", { name: selectedPlan.name })}
            </p>
          </div>
          {showBudgetTabs && (
            <Tabs value={selectedBudget ?? OVERALL} onValueChange={setSelectedBudget}>
              <TabsList>
                <TabsTrigger value={OVERALL}>{t("insights.overall")}</TabsTrigger>
                {plans.map((p) => (
                  <TabsTrigger key={p.id} value={p.id} className="gap-1.5">
                    {p.isMain && (
                      <Star className="h-3 w-3 fill-current text-amber-500" aria-label={t("dashboard.budgetCard.mainBudgetStar")} />
                    )}
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>
        <p className="py-16 text-center text-sm text-muted-foreground">
          {t("insights.noTransactionsPrefix", { name: selectedPlan.name })}{" "}
          <a href="/transactions" className="text-primary hover:underline">
            {t("nav.transactions")}
          </a>{" "}
          {t("insights.noTransactionsSuffix")}
        </p>
      </div>
    );
  }

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
    // Simple mode is one narrow column of sentences — centre it (header included)
    // so it doesn't sit against the left edge with a page of empty space beside it.
    <div className={`space-y-6${simple ? " mx-auto max-w-4xl" : ""}`}>
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("insights.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {usingFinancialMonth && (preset === "this_month" || preset === "last_month") && (
              <>
                {t("insights.financialMonthPrefix", {
                  from: ordinal(startDay),
                  to: ordinal(startDay === 1 ? 31 : startDay - 1),
                })}{" "}
              </>
            )}
            {formatRangeLabel(i18n, dateFrom, dateTo)}
            {daysLeft > 0 &&
              ` · ${plural(daysLeft, "insights.daysLeft.one", "insights.daysLeft.other")}`}
            {plans.length > 0 && (
              <>
                {" · "}
                {selectedPlan
                  ? t("insights.planBudget", { name: selectedPlan.name })
                  : t("insights.allAccountsLower")}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showBudgetTabs && (
            <Tabs
              value={selectedBudget ?? OVERALL}
              onValueChange={setSelectedBudget}
            >
              <TabsList>
                <TabsTrigger value={OVERALL}>{t("insights.overall")}</TabsTrigger>
                {plans.map((p) => (
                  <TabsTrigger key={p.id} value={p.id} className="gap-1.5">
                    {p.isMain && (
                      <Star
                        className="h-3 w-3 fill-current text-amber-500"
                        aria-label={t("dashboard.budgetCard.mainBudgetStar")}
                      />
                    )}
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <Select value={preset} onValueChange={handlePresetChange}>
            {/* Auto width: fixed 160px clipped longer labels in Dutch. */}
            <SelectTrigger className="w-auto min-w-[160px]">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("insights.range.allTime")}</SelectItem>
              <SelectItem value="this_month">{t("insights.range.thisMonth")}</SelectItem>
              <SelectItem value="last_month">{t("insights.range.lastMonth")}</SelectItem>
              <SelectItem value="last_3_months">{t("insights.range.last3Months")}</SelectItem>
              <SelectItem value="this_year">{t("insights.range.thisYear")}</SelectItem>
              <SelectItem value="custom">{t("insights.range.custom")}</SelectItem>
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
              <span className="text-muted-foreground">{t("insights.rangeTo")}</span>
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

      {simple ? (
        <SimpleStory
          data={data}
          totalExpenses={totalExpenses}
          previousLabel={prevLabelKey ? t(prevLabelKey) : null}
          onCategoryClick={navigateToCategory}
          // The one chart simple mode keeps: months against the plan's budget.
          footer={
            <BudgetVsActual
              planName={chartPlan?.name ?? null}
              budgetId={chartPlan?.id}
              monthlyBudget={planMonthlyData?.totalBudget ?? 0}
              allowanceByMonth={allowanceByMonth}
            />
          }
        />
      ) : (
        <>
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
              {t("insights.noComparison", {
                label: deltaLabel ?? t("insights.delta.fallback"),
                date: formatDate(data.statsCutoff),
              })}
            </p>
          )}

          {/* What needs attention, before any chart asks you to find it yourself */}
          <SignalCards
            data={data}
            budget={isSingleFinancialMonth ? budgetData ?? null : null}
            totalExpenses={totalExpenses}
            onCategoryClick={navigateToCategory}
          />

          {/* Overall only: how each budget stands right now, side by side. */}
          {!selectedPlan && plans.length > 0 && (
            <BudgetComparisonStrip plans={plans} onSelect={setSelectedBudget} />
          )}

          {/* Category breakdown (per-category rows) */}
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
              there's room for both without squashing either. [&>*]:min-w-0:
              grid items default to min-width:auto, so the charts' min-width'd
              scroll areas widened the whole page on mobile instead of scrolling
              inside their cards. */}
          <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
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

          {/* Per-plan only: monthly performance against this plan's caps (single
              financial months — the API pro-rates caps for other ranges, which
              misleads here) and spending vs. the current budget over time. */}
          {selectedPlan && isSingleFinancialMonth && (
            <BudgetPerformance
              data={budgetData ?? null}
              accountLabel={accountLabel}
            />
          )}
          {selectedPlan && (
            <BudgetVsActual
              planName={selectedPlan.name}
              budgetId={selectedPlan.id}
              monthlyBudget={planMonthlyData?.totalBudget ?? 0}
              allowanceByMonth={allowanceByMonth}
            />
          )}

          <TopSpending
            merchants={data.topMerchants}
            totalExpenses={totalExpenses}
          />

          {/* The whole period on one canvas: what came in, which account held it,
              where it left to. Collapsed at the bottom — it's the deep-dive view,
              not something to scroll past on every visit. */}
          <MoneyFlow
            data={flowData}
            isLoading={flowLoading}
            open={flowOpen}
            onOpenChange={setFlowOpen}
            onSelect={navigateToTransactions}
          />
        </>
      )}
    </div>
  );
}
