"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useBudgets,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  useGenerateBudgets,
  useAcceptBudgetSuggestions,
  useRejectBudgetSuggestions,
} from "@/hooks/use-budgets";
import { useBudgetPlans } from "@/hooks/use-budget-plans";
import { useAccounts } from "@/hooks/use-accounts";
import { BUDGETABLE_ACCOUNT_TYPES } from "@/lib/account-scope";
import { NON_BUDGETABLE_CATEGORY_NAMES } from "@/lib/default-categories";
import { useCategories } from "@/hooks/use-categories";
import { usePreferences } from "@/hooks/use-preferences";
import {
  formatFinancialMonthLabel,
  getFinancialMonthRange,
} from "@/lib/financial-month";
import {
  currentFinancialSlot,
  getFinancialYearMonths,
  MONTHS_PER_YEAR,
} from "@/lib/financial-year";
import type { Allocation, BudgetPlanData, BudgetSuggestion } from "@/types/api";
import type { EmptyGenerateReason } from "@/lib/auto-budget";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Coins, Sparkles, Wallet, X } from "lucide-react";
import { BudgetHistoryDialog } from "@/components/budget-history-dialog";
import { BudgetSuggestionsDialog } from "@/components/budget-suggestions-dialog";
import { useI18n } from "@/lib/i18n/client";
import { AllocationRow, YearlyAllocationRow } from "./_components/allocation-row";
import { SuggestionRow } from "./_components/suggestion-row";
import { AllocationDialog } from "./_components/allocation-dialog";
import { BudgetsSkeleton } from "./_components/budgets-skeleton";
import { RegenerateConfirmDialog } from "./_components/regenerate-confirm-dialog";
import { RecurringSections } from "./_components/recurring-sections";
import { SectionHeader } from "./_components/section-header";
import { byUrgency } from "./_components/budget-row";
import { BudgetSwitcher } from "./_components/budget-switcher";
import { PeriodNav, type PeriodScope } from "./_components/period-nav";
import { BudgetPlanDialog } from "./_components/budget-plan-dialog";
import { SimpleHero } from "./_components/simple-hero";
import { MonthStats, YearStats } from "./_components/budget-stats";
import { NoticeLine } from "./_components/notice-line";
import { EmptyGenerateNotice } from "./_components/empty-generate-notice";
import { formatRelative, getFinancialMonthForOffset } from "./_components/dates";

/** How far back the month stepper walks — a year of history is plenty. */
const OLDEST_MONTH_OFFSET = 11;
/** How far back the year stepper walks. Three years of history is plenty. */
const OLDEST_YEAR_OFFSET = 3;

export default function BudgetsPage() {
  const i18n = useI18n();
  const { t, plural, formatCurrency, formatDate, intlLocale } = i18n;
  const [monthOffset, setMonthOffset] = useState(0);

  const { data: prefs } = usePreferences();
  const startDay = prefs?.financialMonthStartDay ?? 1;
  // Simple mode: main plan only, no suggestion machinery, no planning stats —
  // just the allocation list and the period picker.
  const simple = prefs?.simpleMode ?? false;

  // Which plan the page shows. Null until the user picks one → main plan.
  const { data: plansData } = useBudgetPlans();
  const plans = plansData?.plans ?? [];
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const activePlan =
    plans.find((p) => p.id === selectedPlanId) ??
    plans.find((p) => p.isMain) ??
    plans[0] ??
    null;
  const activePlanId = activePlan?.id;

  const { data: accountsData, isLoading: accountsLoading } = useAccounts();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BudgetPlanData | null>(null);

  // Yearly plans navigate by financial year and by month inside it; monthly
  // plans keep the rolling month-offset stepper. Null = "whatever is current",
  // resolved by the server so the client never has to know the start day.
  const isYearly = activePlan?.period === "yearly";
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  // Only a yearly plan has a year to zoom out to.
  const [scope, setScope] = useState<PeriodScope>("month");
  const yearScope = isYearly && scope === "year";

  // Which financial month is live right now — for a yearly plan this decides
  // whether the view is editable, the same way monthOffset === 0 does for a
  // monthly one.
  const liveSlot = useMemo(
    () => currentFinancialSlot(startDay),
    [startDay],
  );

  // Where the yearly stepper currently is. Held locally rather than read back
  // off the response so a second click lands while the first is still loading.
  const viewYear = selectedYear ?? liveSlot.year;
  const viewMonthIndex = selectedMonthIndex ?? liveSlot.monthIndex;

  // Switching plans starts the period picker over: a month offset or a year
  // picked while looking at another budget describes a window this one is not
  // showing, and leaving it in place would pair one plan's envelope with
  // another plan's fixed costs. Reset during render — the React-documented way
  // to adjust state to a changed input without an effect.
  const [planKey, setPlanKey] = useState(activePlanId);
  if (planKey !== activePlanId) {
    setPlanKey(activePlanId);
    setMonthOffset(0);
    setSelectedYear(null);
    setSelectedMonthIndex(null);
    setScope("month");
  }

  // The financial month the request asks about. A yearly plan's stepper moves
  // this too: the response's monthly half (fixed costs, income, the month's
  // spend) has to describe the same window as its yearly half, or the list
  // header stops reconciling with the rows under it.
  const { dateFrom, dateTo, monthLabel, daysLeftNow } = useMemo(() => {
    const now = new Date();
    const live = getFinancialMonthRange(now, startDay);
    // Countdown for the "left this month" stat; only the live month has one.
    const daysLeftNow = Math.max(
      0,
      Math.ceil(
        (new Date(live.to + "T23:59:59").getTime() - now.getTime()) / 86400000,
      ),
    );

    if (isYearly) {
      const slot = getFinancialYearMonths(viewYear, startDay)[viewMonthIndex];
      return {
        dateFrom: slot.from,
        dateTo: slot.to,
        monthLabel: formatFinancialMonthLabel(
          new Date(`${slot.from}T00:00:00`),
          startDay,
          intlLocale,
        ),
        daysLeftNow,
      };
    }

    const { from, to, reference } = getFinancialMonthForOffset(
      now,
      startDay,
      monthOffset,
    );
    return {
      dateFrom: from,
      dateTo: to,
      monthLabel: formatFinancialMonthLabel(reference, startDay, intlLocale),
      daysLeftNow,
    };
  }, [isYearly, viewYear, viewMonthIndex, monthOffset, startDay, intlLocale]);

  const { data: data = null, isLoading: loading } = useBudgets({
    dateFrom,
    dateTo,
    budgetId: activePlanId,
    noScale: true,
    ...(isYearly ? { year: viewYear, monthIndex: viewMonthIndex } : {}),
  });
  const yearly = data?.yearly ?? null;

  // A yearly plan is editable while the month on screen is the one being
  // lived in, the same rule monthOffset === 0 encodes for monthly plans.
  // In the year view the whole live year counts — every month of it is still
  // being planned.
  const isLiveYear = isYearly && viewYear === liveSlot.year;
  const isCurrentPeriod = isYearly
    ? isLiveYear && (yearScope || viewMonthIndex === liveSlot.monthIndex)
    : monthOffset === 0;

  // Month labels for the selected financial year. With a start day of 1 these
  // are plain month names; otherwise they show the actual window.
  const monthNamesInYear = useMemo(
    () =>
      getFinancialYearMonths(viewYear, startDay).map((slot) =>
        startDay === 1
          ? new Date(`${slot.from}T00:00:00`).toLocaleDateString(intlLocale, {
              month: "long",
            })
          : formatFinancialMonthLabel(
              new Date(`${slot.from}T00:00:00`),
              startDay,
              intlLocale,
            ),
      ),
    [viewYear, startDay, intlLocale],
  );
  const { data: categoriesData } = useCategories();
  const categories = categoriesData ?? [];
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const deleteBudget = useDeleteBudget();
  const generateBudgets = useGenerateBudgets();
  const acceptSuggestions = useAcceptBudgetSuggestions();
  const rejectSuggestions = useRejectBudgetSuggestions();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlloc, setEditingAlloc] = useState<Allocation | null>(null);
  const [historyAlloc, setHistoryAlloc] = useState<Allocation | null>(null);
  const [suggestionsDialogOpen, setSuggestionsDialogOpen] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  // Why the last generate run came back empty. Without this the button just
  // does nothing and the user is left guessing.
  const [emptyReason, setEmptyReason] = useState<EmptyGenerateReason | null>(null);

  const openEdit = (alloc: Allocation) => {
    setEditingAlloc(alloc);
    setDialogOpen(true);
  };

  const runGenerate = async () => {
    setEmptyReason(null);
    const result = await generateBudgets.mutateAsync({ budgetId: activePlanId });
    if (result.suggestions.length > 0) {
      setSuggestionsDialogOpen(true);
    } else {
      setEmptyReason(result.emptyReason ?? "no-history");
    }
  };

  const handleGenerate = async () => {
    if (data && data.suggestions.length > 0) {
      setRegenerateConfirmOpen(true);
      return;
    }
    await runGenerate();
  };

  const handleConfirmRegenerate = async () => {
    setRegenerateConfirmOpen(false);
    await runGenerate();
  };

  const handleAcceptOne = async (s: BudgetSuggestion) => {
    await acceptSuggestions.mutateAsync([{ id: s.id, amount: s.suggestedAmount }]);
  };

  const handleRejectOne = async (s: BudgetSuggestion) => {
    await rejectSuggestions.mutateAsync([s.id]);
  };

  // One step back or forward through whatever the stepper is currently
  // walking: rolling months, months inside a financial year, or years. Both
  // steppers stop at the live period — the future is not something either kind
  // of plan can report on.
  const oldestYear = liveSlot.year - OLDEST_YEAR_OFFSET;
  const step = (dir: -1 | 1) => {
    if (!isYearly) {
      setMonthOffset((o) => Math.min(OLDEST_MONTH_OFFSET, Math.max(0, o - dir)));
      return;
    }
    if (yearScope) {
      setSelectedYear(
        Math.min(liveSlot.year, Math.max(oldestYear, viewYear + dir)),
      );
      setSelectedMonthIndex(null);
      return;
    }
    // Months roll over into the neighbouring year, then clamp at both ends.
    const absolute = viewYear * MONTHS_PER_YEAR + viewMonthIndex + dir;
    const clamped = Math.min(
      liveSlot.year * MONTHS_PER_YEAR + liveSlot.monthIndex,
      Math.max(oldestYear * MONTHS_PER_YEAR, absolute),
    );
    setSelectedYear(Math.floor(clamped / MONTHS_PER_YEAR));
    setSelectedMonthIndex(clamped % MONTHS_PER_YEAR);
  };

  if (loading || accountsLoading) {
    return <BudgetsSkeleton />;
  }

  // A budget divides up money that lands somewhere. Without a budgetable
  // account there is nothing to plan, so the page sends you to add one first
  // instead of letting you build a plan that can never fill. Only when the
  // query succeeded — a failed fetch must not masquerade as "no accounts".
  if (
    accountsData &&
    !accountsData.some((a) =>
      (BUDGETABLE_ACCOUNT_TYPES as readonly string[]).includes(a.type),
    )
  ) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Wallet className="h-10 w-10 text-muted-foreground/30" />
          <CardTitle className="text-base">{t("budgets.noAccounts.title")}</CardTitle>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("budgets.noAccounts.body")}
          </p>
          <Button asChild className="mt-2">
            <Link href="/settings/accounts">{t("budgets.noAccounts.cta")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Categories available for allocation (not already allocated and not a fixed cost category)
  const fixedCatIds = new Set(data.fixedCosts.map((fc) => fc.categoryId));
  const allocatedCatIds = new Set(data.allocations.map((a) => a.categoryId));
  const availableCategories = categories.filter(
    (c) =>
      !allocatedCatIds.has(c.id) &&
      !fixedCatIds.has(c.id) &&
      !NON_BUDGETABLE_CATEGORY_NAMES.includes(c.name)
  );

  // Card totals are summed from the rows themselves so the header always
  // reconciles with the list under it.
  const allocSpent = data.allocations.reduce((sum, a) => sum + a.spent, 0);
  const allocLimit = data.allocations.reduce((sum, a) => sum + a.amount, 0);
  // What the bills still want out of this month, and how many plans produce it.
  const fixedDue = data.fixedCosts.reduce(
    (sum, fc) => sum + Math.max(0, fc.monthlyAmount - fc.spent),
    0,
  );
  const fixedPayments = data.fixedCosts.reduce((sum, fc) => sum + fc.items.length, 0);

  // Over budget first, then by how much of the budget is used.
  const allocations = [...data.allocations].sort(byUrgency);

  const hasSuggestions = data.suggestions.length > 0;
  const showRegenBanner =
    isCurrentPeriod && data.automation.regenerationDue && !hasSuggestions && !simple;
  // One count for the heading, the stat and the empty state. A yearly plan
  // draws its rows from the envelope rather than the flat allocations, so it
  // has to be counted there or the three disagree the moment they diverge.
  const allocationsCount = yearly
    ? yearly.categories.length
    : data.allocations.length;

  // Yearly rows carry their own totals; the header still reconciles with the
  // list under it, just against this month's allowance rather than a flat cap.
  const allocByCategory = new Map(data.allocations.map((a) => [a.categoryId, a]));
  const yearlyRows = yearly
    ? [...yearly.categories].sort((a, b) => {
        const rank = { "year-over": 0, "month-over": 1, ok: 2 } as const;
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return yearScope ? b.spentYear - a.spentYear : b.spentMonth - a.spentMonth;
      })
    : [];
  // What the list header reconciles against, in the unit currently on screen.
  const listSpent = yearly
    ? yearScope
      ? yearly.totals.spentYear
      : yearly.totals.spentThisMonth
    : allocSpent;
  const listLimit = yearly
    ? yearScope
      ? yearly.totals.annualPot
      : yearly.totals.allowanceThisMonth
    : allocLimit;

  const periodLabel = isYearly
    ? yearScope
      ? String(viewYear)
      : `${monthNamesInYear[viewMonthIndex]} ${viewYear}`
    : monthLabel;

  // Both ends of the yearly stepper, in the unit the current scope walks.
  const prevDisabled = isYearly
    ? yearScope
      ? viewYear <= oldestYear
      : viewYear <= oldestYear && viewMonthIndex === 0
    : monthOffset >= OLDEST_MONTH_OFFSET;
  const nextDisabled = isYearly
    ? yearScope
      ? viewYear >= liveSlot.year
      : isLiveYear && viewMonthIndex >= liveSlot.monthIndex
    : monthOffset === 0;

  // The carry-over story behind this month's allowance, for the stat's subline.
  const carried = yearly
    ? Math.round(yearly.totals.rolloverIntoThisMonth * 100) / 100
    : 0;
  const allowanceNote =
    yearly && carried !== 0
      ? carried > 0
        ? t("budgets.yearly.stat.carriedSavedNote", {
            amount: formatCurrency(carried),
          })
        : t("budgets.yearly.stat.carriedOwedNote", {
            amount: formatCurrency(Math.abs(carried)),
          })
      : undefined;

  return (
    <div className="space-y-6">
      {/* Which budget the page is about. Everything below follows this title.
          Plan management stays available in simple mode too. */}
      {plansData && (
        <BudgetSwitcher
          plans={plans}
          active={activePlan}
          onSelect={setSelectedPlanId}
          onEdit={(p) => {
            setEditingPlan(p);
            setPlanDialogOpen(true);
          }}
          onCreate={() => {
            setEditingPlan(null);
            setPlanDialogOpen(true);
          }}
        />
      )}

      <PeriodNav
        scope={scope}
        onScopeChange={isYearly ? setScope : undefined}
        label={periodLabel}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
      />

      {/* The plan in four numbers. Simple mode swaps them for one friendly
          readout: a yearly plan measures the month against its
          carry-over-adjusted allowance, which is what constrains today. */}
      <div className="space-y-3 border-b pb-6">
        {simple ? (
          listLimit > 0 && (
            <SimpleHero
              spent={listSpent}
              limit={listLimit}
              // Days left in the month, so only offered when the month is what
              // the figures beside it describe.
              daysLeft={isCurrentPeriod && !yearScope ? daysLeftNow : null}
            />
          )
        ) : yearly && yearScope ? (
          <YearStats view={yearly} isLiveYear={isLiveYear} />
        ) : (
          <MonthStats
            toSpend={listLimit}
            spent={listSpent}
            daysLeft={isCurrentPeriod ? daysLeftNow : null}
            fixedDue={fixedDue}
            fixedPayments={fixedPayments}
            categories={allocationsCount}
            allowanceNote={yearly ? allowanceNote : undefined}
          />
        )}

        {/* Every "avg /mo" in the rows below is computed from this date
            onward. Saying so once here beats repeating it on each row. */}
        {data.statsCutoff && (
          <p className="text-xs text-muted-foreground">
            {t("budgets.averagesFrom", { date: formatDate(data.statsCutoff) })}{" "}
            <Link href="/settings/general" className="text-primary hover:underline">
              {t("budgets.change")}
            </Link>
          </p>
        )}
      </div>

      {!yearly && data.unallocated < 0 && (
        <NoticeLine icon={AlertTriangle}>
          {t("budgets.overAllocatedBy", {
            amount: formatCurrency(Math.abs(data.unallocated)),
          })}
        </NoticeLine>
      )}

      {/* The yearly equivalent: a pot bigger than the year's income. */}
      {yearly && yearly.totals.annualPot > yearly.income.total && (
        <NoticeLine icon={AlertTriangle}>
          {t("budgets.yearly.overAllocatedBy", {
            amount: formatCurrency(yearly.totals.annualPot - yearly.income.total),
          })}
        </NoticeLine>
      )}

      {isCurrentPeriod && hasSuggestions && !simple && (
        <NoticeLine icon={Sparkles} filled iconTone="text-primary">
          <span className="text-muted-foreground">
            {plural(
              data.suggestions.length,
              "budgets.suggestionsReady.one",
              "budgets.suggestionsReady.other",
            )}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSuggestionsDialogOpen(true)}
            >
              {t("budgets.reviewApply")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("budgets.dismissAll")}
              disabled={rejectSuggestions.isPending}
              onClick={() =>
                rejectSuggestions.mutate(data.suggestions.map((s) => s.id))
              }
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        </NoticeLine>
      )}

      {showRegenBanner && (
        <NoticeLine icon={Sparkles} filled iconTone="text-primary">
          <span className="text-muted-foreground">
            {plural(
              data.automation.lookbackMonths,
              "budgets.refreshBody.one",
              "budgets.refreshBody.other",
              { when: formatRelative(i18n, data.automation.lastCheckAt) },
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={handleGenerate}
            disabled={generateBudgets.isPending}
          >
            {generateBudgets.isPending && (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            )}
            {t("budgets.generateSuggestions")}
          </Button>
        </NoticeLine>
      )}

      {emptyReason && (
        <EmptyGenerateNotice
          reason={emptyReason}
          i18n={i18n}
          onLinkAccounts={
            activePlan
              ? () => {
                  setEmptyReason(null);
                  setEditingPlan(activePlan);
                  setPlanDialogOpen(true);
                }
              : undefined
          }
          onDismiss={() => setEmptyReason(null)}
        />
      )}

      {/* The whole plan as one list, most-decided-by-you first: the flexible
          spending you steer day to day, then the income and fixed costs that
          are already settled. Fixed costs used to sit in a card of their own
          below this one, which read as an appendix — they are budget lines
          like any other and belong in the same list, at full length, with the
          same columns. */}
      <Card className="overflow-hidden">
        <ul className="divide-y">
          <SectionHeader
            icon={Coins}
            label={t("budgets.allocationsHeading", { count: allocationsCount })}
            note={
              allocationsCount > 0
                ? t("budgets.allocationsSpent", {
                    spent: formatCurrency(listSpent),
                    limit: formatCurrency(listLimit),
                  })
                : undefined
            }
            action={
              <>
                {isCurrentPeriod && !simple && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={generateBudgets.isPending || !data.automation.enabled}
                    title={
                      data.automation.enabled ? undefined : t("budgets.generateDisabled")
                    }
                  >
                    {generateBudgets.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {hasSuggestions
                      ? t("budgets.regenerate")
                      : t("budgets.generateFromHistory")}
                  </Button>
                )}
                {isCurrentPeriod && (
                  <AllocationDialog
                    key={editingAlloc?.id ?? "new"}
                    open={dialogOpen}
                    onOpenChange={(open) => {
                      setDialogOpen(open);
                      if (!open) setEditingAlloc(null);
                    }}
                    editingAlloc={editingAlloc}
                    availableCategories={availableCategories}
                    categoryAverages={data.categoryAverages}
                    unallocated={data.unallocated}
                    yearly={isYearly}
                    onCreate={(categoryId, amount) =>
                      createBudget
                        .mutateAsync({ categoryId, amount, budgetId: activePlanId })
                        .then(() => {})
                    }
                    onUpdate={(id, amount) =>
                      updateBudget.mutateAsync({ id, amount }).then(() => {})
                    }
                  />
                )}
              </>
            }
          />

          {allocationsCount === 0 ? (
            <li className="flex flex-col items-center justify-center px-6 py-10 text-center">
              {simple ? (
                <span className="mb-3 text-4xl" aria-hidden="true">
                  🪴
                </span>
              ) : (
                <Coins className="mb-3 h-10 w-10 text-muted-foreground/30" />
              )}
              <p className="max-w-sm text-sm text-muted-foreground">
                {simple ? t("budgets.emptySimple") : t("budgets.emptyFull")}
              </p>
            </li>
          ) : (
            <>
              {/* Suggestion rows on top with inline accept/reject */}
              {isCurrentPeriod &&
                !simple &&
                data.suggestions.map((s) => (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    busy={acceptSuggestions.isPending || rejectSuggestions.isPending}
                    onAccept={() => handleAcceptOne(s)}
                    onReject={() => handleRejectOne(s)}
                  />
                ))}
              {yearly
                ? yearlyRows.map((category) => {
                    const alloc = allocByCategory.get(category.categoryId);
                    return (
                      <YearlyAllocationRow
                        key={category.categoryId}
                        category={category}
                        alloc={alloc}
                        scope={yearScope ? "year" : "month"}
                        readOnly={!isCurrentPeriod}
                        deletePending={deleteBudget.isPending}
                        onHistory={() => alloc && setHistoryAlloc(alloc)}
                        onEdit={() => alloc && openEdit(alloc)}
                        onDelete={() =>
                          alloc
                            ? deleteBudget.mutateAsync(alloc.id).then(() => {})
                            : Promise.resolve()
                        }
                      />
                    );
                  })
                : allocations.map((alloc) => (
                    <AllocationRow
                      key={alloc.id}
                      alloc={alloc}
                      readOnly={!isCurrentPeriod}
                      deletePending={deleteBudget.isPending}
                      onHistory={() => setHistoryAlloc(alloc)}
                      onEdit={() => openEdit(alloc)}
                      onDelete={() => deleteBudget.mutateAsync(alloc.id).then(() => {})}
                    />
                  ))}
            </>
          )}

          {/* ponytail: month scope only — these are monthly figures and would
              not reconcile inside a year-scoped list. */}
          {!yearScope && (
            <RecurringSections
              fixedCosts={data.fixedCosts}
              planAccountIds={activePlan ? activePlan.accounts.map((a) => a.id) : null}
              accounts={accountsData ?? []}
              categories={categories}
            />
          )}
        </ul>
      </Card>

      <BudgetHistoryDialog
        allocation={historyAlloc}
        budgetId={activePlanId}
        onOpenChange={(open) => {
          if (!open) setHistoryAlloc(null);
        }}
      />

      <BudgetPlanDialog
        key={editingPlan?.id ?? "new"}
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        plan={editingPlan}
        plans={plans}
        accounts={accountsData ?? []}
        onSaved={(planId) => setSelectedPlanId(planId)}
      />

      <BudgetSuggestionsDialog
        open={suggestionsDialogOpen}
        onOpenChange={setSuggestionsDialogOpen}
        suggestions={data.suggestions}
        lookbackMonths={data.automation.lookbackMonths}
      />

      <RegenerateConfirmDialog
        open={regenerateConfirmOpen}
        onOpenChange={setRegenerateConfirmOpen}
        suggestionCount={data.suggestions.length}
        lookbackMonths={data.automation.lookbackMonths}
        pending={generateBudgets.isPending}
        onConfirm={handleConfirmRegenerate}
      />
    </div>
  );
}
