"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { useCategories } from "@/hooks/use-categories";
import { usePreferences } from "@/hooks/use-preferences";
import {
  formatFinancialMonthLabel,
  getFinancialMonthRange,
} from "@/lib/financial-month";
import type { Allocation, BudgetPlanData, BudgetSuggestion } from "@/types/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Loader2,
  Lock,
  Coins,
  Sparkles,
  ChevronRight,
  ArrowRight,
  Info,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BudgetHistoryDialog } from "@/components/budget-history-dialog";
import { BudgetSuggestionsDialog } from "@/components/budget-suggestions-dialog";
import { formatCurrency } from "@/lib/utils";
import { formatResetDate } from "@/lib/stat-reset-marks";
import { AllocationRow } from "./_components/allocation-row";
import { SuggestionRow } from "./_components/suggestion-row";
import { AllocationDialog } from "./_components/allocation-dialog";
import { BudgetsSkeleton } from "./_components/budgets-skeleton";
import { RegenerateConfirmDialog } from "./_components/regenerate-confirm-dialog";
import { CategoryProgressRow } from "./_components/category-progress-row";
import { UsageTotal, UsageBar } from "./_components/usage-summary";
import { byUrgency } from "./_components/budget-row";
import { BudgetPlanTabs } from "./_components/budget-plan-tabs";
import { BudgetPlanDialog } from "./_components/budget-plan-dialog";

const MONTH_OFFSETS = [0, 1, 2, 3] as const;
type MonthOffset = (typeof MONTH_OFFSETS)[number];

// Resolve the financial-month range for `offset` periods before the one
// containing `now`. Walks backward in calendar months from the current FM
// start so each offset lands on a real FM boundary regardless of startDay.
function getFinancialMonthForOffset(
  now: Date,
  startDay: number,
  offset: number,
): { from: string; to: string; reference: Date } {
  const currentRange = getFinancialMonthRange(now, startDay);
  const currentStart = new Date(currentRange.from + "T00:00:00");
  const targetStart = new Date(
    currentStart.getFullYear(),
    currentStart.getMonth() - offset,
    currentStart.getDate(),
  );
  const range = getFinancialMonthRange(targetStart, startDay);
  return { ...range, reference: targetStart };
}

// ponytail: kept hand-rolled — Intl.RelativeTimeFormat would change the
// output (its month bucketing differs from this days/30 approximation).
function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** One cell of the ledger's stat strip. */
function Stat({
  label,
  value,
  note,
  tone = "",
  className = "",
}: {
  label: ReactNode;
  value: string;
  note?: string;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
      </dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone}`}>
        {value}
        {note && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

export default function BudgetsPage() {
  const [monthOffset, setMonthOffset] = useState<MonthOffset>(0);
  const isCurrentMonth = monthOffset === 0;

  const { data: prefs } = usePreferences();
  const startDay = prefs?.financialMonthStartDay ?? 1;

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

  const { data: accountsData } = useAccounts();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BudgetPlanData | null>(null);

  const { dateFrom, dateTo, monthOptions } = useMemo(() => {
    const now = new Date();
    const options = MONTH_OFFSETS.map((offset) => {
      const { from, to, reference } = getFinancialMonthForOffset(
        now,
        startDay,
        offset,
      );
      let label: string;
      if (offset === 0) label = "This month";
      else if (offset === 1) label = "Last month";
      else label = formatFinancialMonthLabel(reference, startDay);
      return { offset, label, from, to };
    });
    const selected = options[monthOffset];
    return {
      dateFrom: selected.from,
      dateTo: selected.to,
      monthOptions: options,
    };
  }, [monthOffset, startDay]);

  const { data: data = null, isLoading: loading } = useBudgets({
    dateFrom,
    dateTo,
    budgetId: activePlanId,
    noScale: true,
  });
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
  const [fixedCostsOpen, setFixedCostsOpen] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);

  const openEdit = (alloc: Allocation) => {
    setEditingAlloc(alloc);
    setDialogOpen(true);
  };

  const runGenerate = async () => {
    const result = await generateBudgets.mutateAsync({ budgetId: activePlanId });
    if (result.suggestions.length > 0) {
      setSuggestionsDialogOpen(true);
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

  if (loading) {
    return <BudgetsSkeleton />;
  }

  if (!data) return null;

  // Categories available for allocation (not already allocated and not a fixed cost category)
  const fixedCatIds = new Set(data.fixedCosts.map((fc) => fc.categoryId));
  const allocatedCatIds = new Set(data.allocations.map((a) => a.categoryId));
  const availableCategories = categories.filter(
    (c) =>
      !allocatedCatIds.has(c.id) &&
      !fixedCatIds.has(c.id) &&
      !["Salary", "Internal Transfer", "Income - Other"].includes(c.name)
  );

  const totalPlanned = data.totalFixedCosts + data.totalAllocated;

  // The strip's split bar is a share of monthly income — or of the plan itself
  // when there's no income on record.
  const planBase = data.monthlyIncome > 0 ? data.monthlyIncome : totalPlanned;
  const pctOf = (value: number) => (planBase > 0 ? (value / planBase) * 100 : 0);
  const fixedPct = Math.min(100, pctOf(data.totalFixedCosts));
  const allocPct = Math.min(100 - fixedPct, pctOf(data.totalAllocated));
  const unallocPct = Math.max(0, 100 - fixedPct - allocPct);

  const periodDays =
    Math.round(
      (new Date(data.month.to + "T00:00:00").getTime() -
        new Date(data.month.from + "T00:00:00").getTime()) /
        86400000,
    ) + 1;
  const perDay = periodDays > 0 ? totalPlanned / periodDays : 0;

  // Card totals are summed from the rows themselves so the header always
  // reconciles with the list under it.
  const allocSpent = data.allocations.reduce((sum, a) => sum + a.spent, 0);
  const allocLimit = data.allocations.reduce((sum, a) => sum + a.amount, 0);
  const fixedSpent = data.fixedCosts.reduce((sum, fc) => sum + fc.spent, 0);
  const fixedLimit = data.fixedCosts.reduce((sum, fc) => sum + fc.monthlyAmount, 0);

  // Over budget first, then by how much of the budget is used.
  const allocations = [...data.allocations].sort(byUrgency);

  const hasSuggestions = data.suggestions.length > 0;
  const showRegenBanner =
    isCurrentMonth && data.automation.regenerationDue && !hasSuggestions;
  const allocationsCount = data.allocations.length;

  return (
    <div className="space-y-6">
      {/* Which budget the page is about. Everything below follows this tab. */}
      {plansData && (
        <BudgetPlanTabs
          plans={plans}
          activeId={activePlanId}
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

      {/* Suggestion banner */}
      {isCurrentMonth && hasSuggestions && (
        <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {data.suggestions.length} budget suggestion
                  {data.suggestions.length === 1 ? "" : "s"} ready to review
                </p>
                <p className="text-xs text-muted-foreground">
                  Based on the last {data.automation.lookbackMonths} month
                  {data.automation.lookbackMonths === 1 ? "" : "s"} of spending. Nothing changes until you accept.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  rejectSuggestions.mutate(data.suggestions.map((s) => s.id))
                }
                disabled={rejectSuggestions.isPending}
              >
                Dismiss all
              </Button>
              <Button onClick={() => setSuggestionsDialogOpen(true)}>
                Review &amp; apply
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Regen-due banner (no current suggestions) */}
      {showRegenBanner && (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-muted p-2 text-muted-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Time to refresh your budgets?</p>
                <p className="text-xs text-muted-foreground">
                  Last checked {formatRelative(data.automation.lastCheckAt)}. We&apos;ll suggest
                  amounts based on the last {data.automation.lookbackMonths} month
                  {data.automation.lookbackMonths === 1 ? "" : "s"}; you decide what to apply.
                </p>
              </div>
            </div>
            <Button onClick={handleGenerate} disabled={generateBudgets.isPending}>
              {generateBudgets.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate suggestions
            </Button>
          </CardContent>
        </Card>
      )}

      {/* The ledger: plan summary and the allocation list in one card. */}
      <Card className="py-6">
        <div className="space-y-5 px-4 sm:px-7">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {data.month.label} &middot;{" "}
                <Link
                  href="/settings/recurring"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  View recurring
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                {activePlan ? activePlan.name : "Budget"}
              </h1>
              {/* Every "avg /mo" below is computed from this date onward. Saying
                  so once here beats repeating it on each row. */}
              {data.statsCutoff && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Averages count from your statistics reset on{" "}
                  {formatResetDate(data.statsCutoff)}.{" "}
                  <Link
                    href="/settings/general"
                    className="text-primary hover:underline"
                  >
                    Change
                  </Link>
                </p>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Select
                value={String(monthOffset)}
                onValueChange={(v) => setMonthOffset(Number(v) as MonthOffset)}
              >
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((opt) => (
                    <SelectItem key={opt.offset} value={String(opt.offset)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isCurrentMonth && (
                <Button
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={handleGenerate}
                  disabled={generateBudgets.isPending || !data.automation.enabled}
                >
                  {generateBudgets.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {hasSuggestions ? "Regenerate" : "Generate from history"}
                </Button>
              )}
              {isCurrentMonth && (
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
            </div>
          </div>

          {/* Stat strip — the plan, without the donut */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Income" value={formatCurrency(data.monthlyIncome)} />
            <Stat
              label="Fixed"
              value={formatCurrency(data.totalFixedCosts)}
              tone="text-muted-foreground"
            />
            <Stat
              label="Allocated"
              value={formatCurrency(data.totalAllocated)}
              tone="text-primary"
            />
            <Stat
              label={
                <>
                  {data.unallocated < 0 ? "Over-allocated" : "Unallocated"}
                  <Popover>
                    <PopoverTrigger
                      aria-label="What do these numbers show?"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 space-y-2 text-sm">
                      <p className="font-medium">Planning view</p>
                      <p className="text-muted-foreground">
                        These numbers are based on your{" "}
                        <span className="font-medium text-foreground">recurring income plan</span>,
                        not actual transactions. Unallocated = recurring income &minus; fixed costs &minus;
                        allocated; it&apos;s the slice of your monthly plan you haven&apos;t assigned to a
                        bucket yet.
                      </p>
                      <p className="text-muted-foreground">
                        This is different from the dashboard&apos;s{" "}
                        <span className="font-medium text-foreground">Free to spend</span>, which uses
                        actual income and actual spending to show what&apos;s left in your wallet right
                        now.
                      </p>
                    </PopoverContent>
                  </Popover>
                </>
              }
              value={formatCurrency(Math.abs(data.unallocated))}
              tone={
                data.unallocated < 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground"
              }
            />
            <Stat
              label="Planned to spend"
              value={formatCurrency(totalPlanned)}
              note={`· ~${formatCurrency(perDay)}/day`}
              className="col-span-2 sm:col-span-1"
            />
          </dl>

          {/* Split bar + legend */}
          <div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-slate-400" style={{ width: `${fixedPct}%` }} />
              <div className="bg-primary" style={{ width: `${allocPct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-slate-400" aria-hidden="true" />
                Fixed {Math.round(fixedPct)}%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-primary" aria-hidden="true" />
                Allocated {Math.round(allocPct)}%
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-sm bg-muted ring-1 ring-border"
                  aria-hidden="true"
                />
                Unallocated {Math.round(unallocPct)}%
              </span>
            </div>
          </div>

          {data.unallocated < 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              You&apos;ve over-allocated by {formatCurrency(Math.abs(data.unallocated))}.
            </div>
          )}
        </div>

        <div className="mt-6 border-t pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-1 sm:px-7">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Spending allocations &middot; {allocationsCount}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {allocationsCount > 0 && (
                <>
                  {formatCurrency(allocSpent)} of {formatCurrency(allocLimit)} spent
                  &middot;{" "}
                </>
              )}
              sorted by urgency &middot; click a row for details
            </span>
          </div>

          {allocationsCount === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <Coins className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="max-w-sm text-sm text-muted-foreground">
                No allocations yet. Use{" "}
                <span className="font-medium text-foreground">Generate from history</span> to
                let the system propose budgets based on your past spending, or add one manually.
              </p>
            </div>
          ) : (
            <ul className="divide-y sm:px-3">
              {/* Suggestion rows on top with inline accept/reject */}
              {isCurrentMonth &&
                data.suggestions.map((s) => (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    busy={acceptSuggestions.isPending || rejectSuggestions.isPending}
                    onAccept={() => handleAcceptOne(s)}
                    onReject={() => handleRejectOne(s)}
                  />
                ))}
              {allocations.map((alloc) => (
                <AllocationRow
                  key={alloc.id}
                  alloc={alloc}
                  readOnly={!isCurrentMonth}
                  deletePending={deleteBudget.isPending}
                  onHistory={() => setHistoryAlloc(alloc)}
                  onEdit={() => openEdit(alloc)}
                  onDelete={() => deleteBudget.mutateAsync(alloc.id).then(() => {})}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Fixed Costs — collapsible */}
      <Card>
        <CardHeader className="pb-4">
          <button
            type="button"
            onClick={() => setFixedCostsOpen((o) => !o)}
            aria-expanded={fixedCostsOpen}
            aria-controls="fixed-costs-list"
            className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-2 rounded-md text-left"
          >
            <div className="flex min-w-0 items-center gap-2">
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${fixedCostsOpen ? "rotate-90" : ""}`}
              />
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <CardTitle className="text-base">Fixed Costs</CardTitle>
                <CardDescription>
                  {data.fixedCosts.length} recurring categor
                  {data.fixedCosts.length === 1 ? "y" : "ies"}
                </CardDescription>
              </div>
            </div>
            {data.fixedCosts.length > 0 && (
              <UsageTotal
                spent={fixedSpent}
                limit={fixedLimit}
                remainingLabel="due"
              />
            )}
          </button>
          {data.fixedCosts.length > 0 && (
            <UsageBar spent={fixedSpent} limit={fixedLimit} />
          )}
          {fixedCostsOpen && (
            <CardDescription className="pt-1 text-xs">
              Auto-populated from recurring expenses. Manage them on the{" "}
              <Link href="/settings/recurring" className="text-primary hover:underline">
                Recurring
              </Link>{" "}
              page.
            </CardDescription>
          )}
        </CardHeader>
        {fixedCostsOpen && (
          <CardContent id="fixed-costs-list" className="px-0 sm:px-3">
            {data.fixedCosts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No recurring expenses set up yet.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {data.fixedCosts.map((fc) => {
                  const pct = fc.monthlyAmount > 0 ? Math.min(100, (fc.spent / fc.monthlyAmount) * 100) : 0;
                  const outstanding = fc.monthlyAmount - fc.spent;
                  const over = outstanding <= -0.01;
                  const settled = Math.abs(outstanding) < 0.01;
                  return (
                    <CategoryProgressRow
                      key={fc.categoryId}
                      categoryId={fc.categoryId}
                      color={fc.categoryColor}
                      name={fc.categoryName}
                      progressPct={pct}
                      barClassName={over ? "bg-red-500" : "bg-slate-400"}
                      subtitle={
                        <div className="truncate text-xs text-muted-foreground">
                          {fc.items
                            .slice(0, 3)
                            .map((i) => i.description)
                            .join(" · ")}
                          {fc.items.length > 3 ? ` +${fc.items.length - 3}` : ""}
                        </div>
                      }
                      amount={
                        <>
                          <span className="font-medium">{formatCurrency(fc.spent)}</span>
                          <span className="text-muted-foreground">
                            {" / "}
                            {formatCurrency(fc.monthlyAmount)}
                          </span>
                        </>
                      }
                      delta={
                        <span
                          className={
                            over ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                          }
                        >
                          {over
                            ? `${formatCurrency(-outstanding)} over`
                            : settled
                              ? "paid"
                              : `${formatCurrency(outstanding)} due`}
                        </span>
                      }
                    />
                  );
                })}
              </ul>
            )}
          </CardContent>
        )}
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
