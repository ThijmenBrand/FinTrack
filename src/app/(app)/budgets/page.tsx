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
import { useCategories } from "@/hooks/use-categories";
import { usePreferences } from "@/hooks/use-preferences";
import {
  formatFinancialMonthLabel,
  getFinancialMonthRange,
} from "@/lib/financial-month";
import type { Allocation, BudgetSuggestion } from "@/types/api";
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
  ChevronDown,
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
import { AllocationRow } from "./_components/allocation-row";
import { SuggestionRow } from "./_components/suggestion-row";
import { AllocationDialog } from "./_components/allocation-dialog";
import { RegenerateConfirmDialog } from "./_components/regenerate-confirm-dialog";
import { CategoryProgressRow } from "./_components/category-progress-row";

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

export default function BudgetsPage() {
  const [monthOffset, setMonthOffset] = useState<MonthOffset>(0);
  const isCurrentMonth = monthOffset === 0;

  const { data: prefs } = usePreferences();
  const startDay = prefs?.financialMonthStartDay ?? 1;

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
    const result = await generateBudgets.mutateAsync();
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
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
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
      !["Salary", "Internal Transfer", "Income - Other"].includes(c.name)
  );

  // Budget bar percentages
  const incomeTotal = data.monthlyIncome;
  const fixedPct = incomeTotal > 0 ? (data.totalFixedCosts / incomeTotal) * 100 : 0;
  const allocatedPct = incomeTotal > 0 ? (data.totalAllocated / incomeTotal) * 100 : 0;
  const unallocatedPct = incomeTotal > 0 ? (Math.max(0, data.unallocated) / incomeTotal) * 100 : 0;
  const totalPlanned = data.totalFixedCosts + data.totalAllocated;

  const hasSuggestions = data.suggestions.length > 0;
  const showRegenBanner =
    isCurrentMonth && data.automation.regenerationDue && !hasSuggestions;
  const allocationsCount = data.allocations.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Budget</h1>
          <p className="text-muted-foreground">
            {data.month.label} &mdash; allocate your income across spending categories.{" "}
            <Link
              href="/settings/recurring"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View recurring
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(monthOffset)}
            onValueChange={(v) => setMonthOffset(Number(v) as MonthOffset)}
          >
            <SelectTrigger className="w-[180px]">
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
                createBudget.mutateAsync({ categoryId, amount }).then(() => {})
              }
              onUpdate={(id, amount) =>
                updateBudget.mutateAsync({ id, amount }).then(() => {})
              }
            />
          )}
        </div>
      </div>

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

      {/* Budget Overview Bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-base">Overview</CardTitle>
                <Popover>
                  <PopoverTrigger
                    aria-label="What does this overview show?"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 text-sm space-y-2">
                    <p className="font-medium">Planning view</p>
                    <p className="text-muted-foreground">
                      These numbers are based on your <span className="font-medium text-foreground">recurring income plan</span>,
                      not actual transactions. Unallocated = recurring income − fixed costs − allocated;
                      it&apos;s the slice of your monthly plan you haven&apos;t assigned to a bucket yet.
                    </p>
                    <p className="text-muted-foreground">
                      This is different from the dashboard&apos;s <span className="font-medium text-foreground">Free to spend</span>,
                      which uses actual income and actual spending to show what&apos;s left in your wallet right now.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <CardDescription>
                {formatCurrency(data.monthlyIncome)} income · {formatCurrency(data.totalFixedCosts)} fixed ·{" "}
                {formatCurrency(data.totalAllocated)} allocated ·{" "}
                <span className={data.unallocated >= 0 ? "" : "text-red-600 dark:text-red-400"}>
                  {formatCurrency(Math.max(0, data.unallocated))} {data.unallocated < 0 ? "over" : "unallocated"}
                </span>
              </CardDescription>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold tabular-nums leading-none">
                {formatCurrency(totalPlanned)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                planned to spend
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 rounded-full bg-muted overflow-hidden flex">
            {fixedPct > 0 && (
              <div
                className="h-full bg-slate-400 transition-all duration-500"
                style={{ width: `${fixedPct}%` }}
                title={`Fixed costs: ${fixedPct.toFixed(1)}%`}
              />
            )}
            {allocatedPct > 0 && (
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${allocatedPct}%` }}
                title={`Allocated: ${allocatedPct.toFixed(1)}%`}
              />
            )}
            {unallocatedPct > 0 && (
              <div
                className="h-full bg-emerald-400/40 transition-all duration-500"
                style={{ width: `${unallocatedPct}%` }}
                title={`Unallocated: ${unallocatedPct.toFixed(1)}%`}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-slate-400" />
              Fixed {fixedPct.toFixed(0)}%
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-blue-500" />
              Allocated {allocatedPct.toFixed(0)}%
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-emerald-400/40" />
              Unallocated {Math.max(0, unallocatedPct).toFixed(0)}%
            </span>
          </div>
          {data.unallocated < 0 && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4" />
              You&apos;ve over-allocated by {formatCurrency(Math.abs(data.unallocated))}.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Allocations — compact list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Spending Allocations</CardTitle>
              <CardDescription>
                {allocationsCount === 0
                  ? "No allocations yet"
                  : `${allocationsCount} categor${allocationsCount === 1 ? "y" : "ies"} · click any row for history`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {data.allocations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-6">
              <Coins className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground max-w-sm">
                No allocations yet. Use{" "}
                <span className="font-medium text-foreground">Generate from history</span> to
                let the system propose budgets based on your past spending, or add one manually.
              </p>
            </div>
          ) : (
            <ul className="divide-y border-y sm:border-x sm:rounded-md">
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
              {data.allocations.map((alloc) => (
                <AllocationRow
                  key={alloc.id}
                  alloc={alloc}
                  readOnly={!isCurrentMonth}
                  deletePending={deleteBudget.isPending}
                  onClick={() => setHistoryAlloc(alloc)}
                  onEdit={() => openEdit(alloc)}
                  onDelete={() => deleteBudget.mutateAsync(alloc.id).then(() => {})}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Fixed Costs — collapsible */}
      <Card>
        <CardHeader className="pb-3">
          <button
            type="button"
            onClick={() => setFixedCostsOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              {fixedCostsOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Lock className="h-4 w-4 text-slate-400" />
              <CardTitle className="text-base">Fixed Costs</CardTitle>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatCurrency(data.totalFixedCosts)}/mo · {data.fixedCosts.length}
            </span>
          </button>
          {fixedCostsOpen && (
            <CardDescription className="pt-1">
              Auto-populated from recurring expenses. Manage on the{" "}
              <a href="/settings/recurring" className="underline">
                Recurring
              </a>{" "}
              page.
            </CardDescription>
          )}
        </CardHeader>
        {fixedCostsOpen && (
          <CardContent className="px-0 sm:px-6">
            {data.fixedCosts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No recurring expenses set up yet.
              </p>
            ) : (
              <ul className="divide-y border-y sm:border-x sm:rounded-md">
                {data.fixedCosts.map((fc) => {
                  const pct = fc.monthlyAmount > 0 ? Math.min(100, (fc.spent / fc.monthlyAmount) * 100) : 0;
                  return (
                    <CategoryProgressRow
                      key={fc.categoryId}
                      categoryId={fc.categoryId}
                      color={fc.categoryColor}
                      name={fc.categoryName}
                      progressPct={pct}
                      subtitle={
                        <div className="text-xs text-muted-foreground">
                          {fc.items.length} item{fc.items.length === 1 ? "" : "s"}
                        </div>
                      }
                      amount={
                        <span className="text-sm tabular-nums">
                          <span className="font-medium">{formatCurrency(fc.spent)}</span>
                          <span className="text-muted-foreground">
                            {" / "}
                            {formatCurrency(fc.monthlyAmount)}
                          </span>
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
        onOpenChange={(open) => {
          if (!open) setHistoryAlloc(null);
        }}
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
