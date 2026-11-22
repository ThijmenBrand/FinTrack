"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftRight, Calendar, Loader2 } from "lucide-react";
import {
  useInsights,
  useBalanceTimeline,
  useMoneyFlow,
} from "@/hooks/use-insights";
import { useBudgets } from "@/hooks/use-budgets";
import { ALL_BUDGETS, useBudgetScope } from "@/hooks/use-budget-scope";
import { BudgetScopeSelect } from "@/components/budget-scope-select";
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
import {
  daysLeftIn,
  elapsedDays,
  formatRangeLabel,
  isCalendarDate,
} from "./_components/period";
import { BudgetVsActual } from "./_components/budget-vs-actual";
import { BudgetComparisonStrip } from "./_components/budget-comparison-strip";
import { SimpleStory } from "./_components/simple-story";
import { PeriodCompare } from "./_components/period-compare";
import { toIsoDate } from "@/lib/utils";

type PresetKey = "this_month" | "last_month" | "this_year" | "last_3_months" | "all" | "custom";

const PRESET_TO_TX_PERIOD: Partial<Record<PresetKey, string>> = {
  this_month: "this-month",
  last_month: "last-month",
  last_3_months: "last-3-months",
  this_year: "this-year",
};

/** Every preset, in the order a phone shows them as chips. */
const PRESET_OPTIONS: { key: PresetKey; labelKey: MessageKey }[] = [
  { key: "this_month", labelKey: "insights.range.thisMonth" },
  { key: "last_month", labelKey: "insights.range.lastMonth" },
  { key: "last_3_months", labelKey: "insights.range.last3Months" },
  { key: "this_year", labelKey: "insights.range.thisYear" },
  { key: "all", labelKey: "insights.range.allTime" },
  { key: "custom", labelKey: "insights.range.custom" },
];

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

function sameRange(
  a: { from: string; to: string },
  b: { from: string; to: string },
): boolean {
  return a.from === b.from && a.to === b.to;
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

// ── Period comparison ──────────────────────────────────────────────────────
// The second period is picked from the same presets as the first, plus
// "previous" — the range that already backs the vs-previous deltas, and the
// one you want nine times out of ten.
type ComparePresetKey = "previous" | Exclude<PresetKey, "all">;

const COMPARE_OPTIONS: { key: ComparePresetKey; labelKey: MessageKey }[] = [
  { key: "previous", labelKey: "insights.periodCompare.previousLabel" },
  { key: "this_month", labelKey: "insights.range.thisMonth" },
  { key: "last_month", labelKey: "insights.range.lastMonth" },
  { key: "last_3_months", labelKey: "insights.range.last3Months" },
  { key: "this_year", labelKey: "insights.range.thisYear" },
  { key: "custom", labelKey: "insights.range.custom" },
];

const VALID_COMPARE_PRESETS = new Set<ComparePresetKey>(
  COMPARE_OPTIONS.map((o) => o.key),
);

function parseComparePreset(value: string | null): ComparePresetKey {
  return value && VALID_COMPARE_PRESETS.has(value as ComparePresetKey)
    ? (value as ComparePresetKey)
    : "previous";
}

/** The comparison period's dates, or null when it isn't pinned down yet. */
function resolveCompareRange(
  compare: ComparePresetKey,
  preset: PresetKey,
  startDay: number,
  dateFrom: string,
  dateTo: string,
  customFrom: string,
  customTo: string,
): { from: string; to: string } | null {
  if (compare === "previous")
    return getPreviousRange(preset, startDay, dateFrom, dateTo);
  if (compare === "custom")
    return isCalendarDate(customFrom) && isCalendarDate(customTo)
      ? { from: customFrom, to: customTo }
      : null;
  return getPresetRange(compare, startDay);
}

const VALID_PRESETS = new Set<PresetKey>([
  "this_month",
  "last_month",
  "last_3_months",
  "this_year",
  "all",
  "custom",
]);

/**
 * A date from the query string, or "" when it isn't one. Everything downstream
 * — the range label, the API call — assumes a real date, and `?dateTo=invalid`
 * would otherwise crash the render inside Intl.
 */
function parseDateParam(value: string | null): string {
  return value && isCalendarDate(value) ? value : "";
}

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

// The budget tabs are a second surface onto the app-wide scope, not a
// selection of their own — picking one here moves the sidebar selector too.
// Replaces the per-device localStorage selection this page used to keep.

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
  const [customDateFrom, setCustomDateFrom] = useState<string>(() =>
    parseDateParam(searchParams.get("dateFrom")),
  );
  const [customDateTo, setCustomDateTo] = useState<string>(() =>
    parseDateParam(searchParams.get("dateTo")),
  );
  // Comparison mode: two periods of one budget, side by side. Which budget is
  // the app-wide scope's business, not this view's — so the two columns differ
  // by time alone. All Time has no second period to name, so it can't be the
  // first one.
  const [compareOn, setCompareOn] = useState<boolean>(
    () => searchParams.get("compare") === "1",
  );
  const [comparePreset, setComparePreset] = useState<ComparePresetKey>(() =>
    parseComparePreset(searchParams.get("comparePreset")),
  );
  const [compareDateFrom, setCompareDateFrom] = useState<string>(() =>
    parseDateParam(searchParams.get("compareFrom")),
  );
  const [compareDateTo, setCompareDateTo] = useState<string>(() =>
    parseDateParam(searchParams.get("compareTo")),
  );
  // Which view: "all budgets" or one plan — the app-wide scope, which already
  // resolves a stale or deleted plan id back to the main budget.
  const {
    plans,
    plan: selectedPlan,
    setValue: setSelectedBudget,
    isLoading: scopeLoading,
  } = useBudgetScope();

  // ?budget= links in from an account dialog. Like /budgets?plan=, "show me
  // this budget's insights" moves the app-wide scope instead of diverging
  // from it. Applied once; the URL sync below drops the param afterwards.
  const linkedBudgetId = searchParams.get("budget");
  const linkHandledRef = useRef(false);
  useEffect(() => {
    if (!linkedBudgetId || linkHandledRef.current || scopeLoading) return;
    linkHandledRef.current = true;
    if (linkedBudgetId === ALL_BUDGETS || plans.some((p) => p.id === linkedBudgetId)) {
      setSelectedBudget(linkedBudgetId);
    }
  }, [linkedBudgetId, scopeLoading, plans, setSelectedBudget]);
  // Which plan the budget-vs-actual chart follows. Simple mode shows one
  // budget's story, so an Overall selection (saved from before, or from the
  // full view) would silently drop the chart with no way to get it back.
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

  // Sync the date filters back into the URL so a back-nav restores the same
  // view. The budget is not among them: it lives in the app-wide scope.
  useEffect(() => {
    const params = new URLSearchParams();
    if (preset !== "this_month") params.set("preset", preset);
    if (preset === "custom") {
      if (customDateFrom) params.set("dateFrom", customDateFrom);
      if (customDateTo) params.set("dateTo", customDateTo);
    }
    if (compareOn) {
      params.set("compare", "1");
      if (comparePreset !== "previous") params.set("comparePreset", comparePreset);
      if (comparePreset === "custom") {
        if (compareDateFrom) params.set("compareFrom", compareDateFrom);
        if (compareDateTo) params.set("compareTo", compareDateTo);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `/insights?${qs}` : "/insights", { scroll: false });
  }, [
    preset,
    customDateFrom,
    customDateTo,
    compareOn,
    comparePreset,
    compareDateFrom,
    compareDateTo,
    router,
  ]);

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

  // Comparison mode is off in simple mode (which has no second column to put
  // it in) and over All Time (no second period to compare against — the
  // toggle stays, disabled, so it doesn't vanish mid-session).
  const canCompare = !simple && preset !== "all";
  const compareRange = canCompare
    ? resolveCompareRange(
        comparePreset,
        preset,
        startDay,
        dateFrom,
        dateTo,
        compareDateFrom,
        compareDateTo,
      )
    : null;
  const compareActive = canCompare && compareOn;
  // Same range on both sides is a comparison with nothing in it — the view
  // says so instead of drawing two identical columns.
  const compareIsSelf =
    compareRange !== null && sameRange(compareRange, { from: dateFrom, to: dateTo });
  const { data: compareData, isLoading: compareLoading } = useInsights({
    dateFrom: compareRange?.from,
    dateTo: compareRange?.to,
    accountId: accountIdParam,
    budgetId: selectedPlan?.id,
    enabled: compareActive && compareRange !== null && !compareIsSelf,
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
  // A custom range counts when it is exactly one financial month — which is
  // what a month clicked on the vs-actual chart becomes.
  const isSingleFinancialMonth =
    preset === "this_month" ||
    preset === "last_month" ||
    (preset === "custom" &&
      !!dateFrom &&
      sameRange(
        getFinancialMonthRange(new Date(dateFrom + "T00:00:00"), startDay),
        { from: dateFrom, to: dateTo },
      ));
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
    // Only the bills no envelope already covers: a category with both an
    // allocation and recurring plans has those plans inside its allowance, so
    // adding them again raised the ceiling by a bill the plan pays once.
    const envelopeCategories = new Set(
      (planMonthlyData?.yearly?.categories ?? []).map((c) => c.categoryId),
    );
    const fixed = (planMonthlyData?.fixedCosts ?? [])
      .filter((fc) => !envelopeCategories.has(fc.categoryId))
      .reduce((sum, fc) => sum + fc.monthlyAmount, 0);
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

  // A bar on the vs-actual chart is a calendar month, so that's the range it
  // opens — as the this/last-month preset when that names the same days, a
  // custom range otherwise. Back to the top: the chart sits near the bottom,
  // and the numbers that just changed are above it.
  const selectMonth = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    const range = {
      from: toIsoDate(new Date(y, m - 1, 1)),
      to: toIsoDate(new Date(y, m, 0)),
    };
    const shortcut = (["this_month", "last_month"] as const).find((p) =>
      sameRange(getPresetRange(p, startDay), range),
    );
    if (shortcut) {
      setPreset(shortcut);
    } else {
      setCustomDateFrom(range.from);
      setCustomDateTo(range.to);
      setPreset("custom");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // The chart month the page is showing, when the range is exactly one.
  const activeMonth = (() => {
    if (!dateFrom) return null;
    const [y, m, d] = dateFrom.split("-").map(Number);
    return d === 1 && dateTo === toIsoDate(new Date(y, m, 0))
      ? dateFrom.slice(0, 7)
      : null;
  })();

  const navigateToTransactions = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
    // Hand the transactions page the budget's WHOLE account set, so the list
    // it lands on is scoped exactly like the numbers that were clicked. It
    // reads `account` as a comma-separated list. A caller that named an
    // account itself (a money-flow leg belongs to one account) wins.
    if (!params.has("account") && accountIdParam)
      params.set("account", accountIdParam);
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

  // A comparison row's amount opens that category over the period the amount
  // belongs to — explicit dates, since only one of the two is the page range.
  const navigateToComparedCategory = (
    categoryId: string | null,
    period: "a" | "b",
  ) => {
    const range =
      period === "a" ? { from: dateFrom, to: dateTo } : compareRange;
    if (!range) return;
    navigateToTransactions({
      ...(categoryId ? { category: categoryId } : {}),
      dateFrom: range.from,
      dateTo: range.to,
    });
  };

  const presetLabel = (key: PresetKey) =>
    t(PRESET_OPTIONS.find((o) => o.key === key)!.labelKey);
  const comparePresetLabel = (key: ComparePresetKey) =>
    t(COMPARE_OPTIONS.find((o) => o.key === key)!.labelKey);

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
            {/* Phones have no sidebar to hold the scope selector. */}
            <div className="mt-2 md:hidden">
              <BudgetScopeSelect variant="header" />
            </div>
          </div>
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
    <div className={`space-y-4 md:space-y-6${simple ? " mx-auto max-w-4xl" : ""}`}>
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
                {selectedPlan ? (
                  // The budget behind these numbers — follow it through to the
                  // plan itself rather than hunting for it on the budgets page.
                  <Link
                    href="/budgets"
                    className="text-primary hover:underline"
                  >
                    {t("insights.planBudget", { name: selectedPlan.name })}
                  </Link>
                ) : (
                  t("insights.allAccountsLower")
                )}
              </>
            )}
          </p>
          {/* Phones have no sidebar to hold the scope selector. */}
          <div className="mt-2 md:hidden">
            <BudgetScopeSelect variant="header" />
          </div>
        </div>
        {/* Phones: the ranges become a row of chips — one tap each, instead of
            a dropdown to open first. */}
        <div className="flex items-center gap-2 flex-wrap max-md:w-full max-md:flex-col max-md:items-stretch max-md:gap-3">
          <div
            role="radiogroup"
            aria-label={t("insights.rangeLabel")}
            className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 md:hidden"
          >
            {PRESET_OPTIONS.map((o) => {
              const active = preset === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handlePresetChange(o.key)}
                  className={`h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "bg-card text-foreground/80 active:bg-muted"
                  }`}
                >
                  {t(o.labelKey)}
                </button>
              );
            })}
          </div>
          <Select value={preset} onValueChange={handlePresetChange}>
            {/* Auto width: fixed 160px clipped longer labels in Dutch. */}
            <SelectTrigger className="w-auto min-w-[160px] max-md:hidden">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_OPTIONS.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {t(o.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="w-[150px] max-md:w-auto max-md:min-w-0 max-md:flex-1"
              />
              <span className="text-muted-foreground">{t("insights.rangeTo")}</span>
              <Input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="w-[150px] max-md:w-auto max-md:min-w-0 max-md:flex-1"
              />
            </div>
          )}
          {!simple && (
            <button
              type="button"
              onClick={() => setCompareOn((on) => !on)}
              aria-pressed={compareActive}
              disabled={preset === "all"}
              title={
                preset === "all" ? t("insights.periodCompare.allTimeHint") : undefined
              }
              className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                compareActive
                  ? "border-foreground bg-foreground text-background"
                  : "bg-card text-foreground/80 hover:bg-muted active:bg-muted"
              }`}
            >
              <ArrowLeftRight className="h-4 w-4" />
              {t("insights.periodCompare.toggle")}
            </button>
          )}
          {/* Second period: its own row, so the two pickers read as a pair
              rather than a third filter. */}
          {compareActive && (
            <div className="flex w-full items-center gap-2 max-md:flex-col max-md:items-stretch">
              <span className="shrink-0 text-sm text-muted-foreground">
                {t("insights.periodCompare.versus")}
              </span>
              <Select
                value={comparePreset}
                onValueChange={(v) => setComparePreset(v as ComparePresetKey)}
              >
                <SelectTrigger className="w-auto min-w-[180px] max-md:w-full">
                  <Calendar className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARE_OPTIONS.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {comparePreset === "custom" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    aria-label={t("insights.periodCompare.fromLabel")}
                    value={compareDateFrom}
                    onChange={(e) => setCompareDateFrom(e.target.value)}
                    className="w-[150px] max-md:w-auto max-md:min-w-0 max-md:flex-1"
                  />
                  <span className="text-muted-foreground">{t("insights.rangeTo")}</span>
                  <Input
                    type="date"
                    aria-label={t("insights.periodCompare.toLabel")}
                    value={compareDateTo}
                    onChange={(e) => setCompareDateTo(e.target.value)}
                    className="w-[150px] max-md:w-auto max-md:min-w-0 max-md:flex-1"
                  />
                </div>
              )}
              {compareRange && !compareIsSelf && (
                <span className="truncate text-xs text-muted-foreground max-md:text-center">
                  {formatRangeLabel(i18n, compareRange.from, compareRange.to)}
                </span>
              )}
            </div>
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
              onSelectMonth={selectMonth}
              activeMonth={activeMonth}
            />
          }
        />
      ) : compareActive ? (
        !compareRange ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("insights.periodCompare.pickPeriod")}
          </p>
        ) : compareIsSelf ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {t("insights.periodCompare.samePeriod")}
          </p>
        ) : (
          <PeriodCompare
            a={{
              label: presetLabel(preset),
              rangeLabel: formatRangeLabel(i18n, dateFrom, dateTo),
              from: dateFrom,
              to: dateTo,
            }}
            b={{
              label: comparePresetLabel(comparePreset),
              rangeLabel: formatRangeLabel(i18n, compareRange.from, compareRange.to),
              from: compareRange.from,
              to: compareRange.to,
            }}
            aData={data}
            bData={compareData}
            bLoading={compareLoading}
            scopeLabel={accountLabel}
            onCategorySelect={navigateToComparedCategory}
          />
        )
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
            <p className="-mt-2 text-xs text-muted-foreground md:-mt-4">
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
              onSelectMonth={selectMonth}
              activeMonth={activeMonth}
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
