"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Loader2,
  Lock,
  Coins,
  PiggyBank,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { BudgetHistoryDialog } from "@/components/budget-history-dialog";
import { BudgetSuggestionsDialog } from "@/components/budget-suggestions-dialog";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

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
  const router = useRouter();
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
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [historyAlloc, setHistoryAlloc] = useState<Allocation | null>(null);
  const [suggestionsDialogOpen, setSuggestionsDialogOpen] = useState(false);
  const [fixedCostsOpen, setFixedCostsOpen] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);

  // Form
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formAmount, setFormAmount] = useState("");

  const resetForm = () => {
    setFormCategoryId("");
    setFormAmount("");
    setEditingAlloc(null);
  };

  const openEdit = (alloc: Allocation) => {
    setEditingAlloc(alloc);
    setFormCategoryId(alloc.categoryId);
    setFormAmount(String(alloc.amount));
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const amount = parseFloat(formAmount);
    if (!amount || amount <= 0) return;

    await (editingAlloc
      ? updateBudget.mutateAsync({ id: editingAlloc.id, amount })
      : createBudget.mutateAsync({ categoryId: formCategoryId, amount }));

    setDialogOpen(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await deleteBudget.mutateAsync(id);
    setDeleteConfirm(null);
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
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add manually
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingAlloc ? "Edit Allocation" : "Add Budget Allocation"}
                </DialogTitle>
                <DialogDescription>
                  {editingAlloc
                    ? `Update the monthly budget for ${editingAlloc.categoryName}.`
                    : `Allocate from your ${formatCurrency(data.unallocated)} unallocated budget.`}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {!editingAlloc && (
                  <div className="grid gap-2">
                    <Label>Category</Label>
                    <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCategories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            <span className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: cat.color || "#94a3b8" }}
                              />
                              {cat.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label>Monthly Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      &euro;
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="150.00"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  {!editingAlloc && formCategoryId && data.categoryAverages[formCategoryId] ? (
                    <p className="text-xs text-muted-foreground">
                      You typically spend{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-2"
                        onClick={() => setFormAmount(String(data.categoryAverages[formCategoryId]))}
                      >
                        {formatCurrency(data.categoryAverages[formCategoryId])}
                      </button>
                      /mo on average in this category.
                    </p>
                  ) : editingAlloc && editingAlloc.avgMonthly > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      You typically spend{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-2"
                        onClick={() => setFormAmount(String(editingAlloc.avgMonthly))}
                      >
                        {formatCurrency(editingAlloc.avgMonthly)}
                      </button>
                      /mo on average in this category.
                    </p>
                  ) : null}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !formAmount ||
                    parseFloat(formAmount) <= 0 ||
                    (!editingAlloc && !formCategoryId)
                  }
                >
                  {editingAlloc ? "Save" : "Allocate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
              <CardTitle className="text-base">Overview</CardTitle>
              <CardDescription>
                {formatCurrency(data.monthlyIncome)} income · {formatCurrency(data.totalFixedCosts)} fixed ·{" "}
                {formatCurrency(data.totalAllocated)} allocated ·{" "}
                <span className={data.unallocated >= 0 ? "" : "text-red-600 dark:text-red-400"}>
                  {formatCurrency(Math.max(0, data.unallocated))} {data.unallocated < 0 ? "over" : "free"}
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
              Free {Math.max(0, unallocatedPct).toFixed(0)}%
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
                  isDeleteConfirming={deleteConfirm === alloc.id}
                  readOnly={!isCurrentMonth}
                  onClick={() => setHistoryAlloc(alloc)}
                  onEdit={() => openEdit(alloc)}
                  onDelete={() => handleDelete(alloc.id)}
                  onAskDelete={() => setDeleteConfirm(alloc.id)}
                  onCancelDelete={() => setDeleteConfirm(null)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Reserved (savings / set-aside) */}
      {data.reserved && data.reserved.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PiggyBank className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                <CardTitle className="text-base">Reserved</CardTitle>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatCurrency(data.totalReserved)}/mo · {data.reserved.length}
              </span>
            </div>
            <CardDescription className="pt-1">
              Set aside off Free to Spend. Categories with a monthly target
              count their target — or actuals, whichever is larger — toward
              the budget.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <ul className="divide-y border-y sm:border-x sm:rounded-md">
              {data.reserved.map((r) => {
                const hasTarget = r.target !== null && r.target > 0;
                const pct =
                  hasTarget && r.target! > 0
                    ? Math.min(100, (r.funded / r.target!) * 100)
                    : 0;
                return (
                  <li
                    key={r.categoryId}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/transactions?category=${r.categoryId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/transactions?category=${r.categoryId}`);
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: r.categoryColor || "#3b82f6" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {r.categoryName ?? "Unknown"}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {hasTarget
                            ? `${formatCurrency(r.funded)} of ${formatCurrency(r.target!)}`
                            : formatCurrency(r.funded)}
                        </span>
                      </div>
                      {hasTarget && (
                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="px-4 pt-3 text-xs text-muted-foreground">
              Set or change a monthly target by allocating a budget to the
              reserved category via <strong>Add manually</strong> above.
            </p>
          </CardContent>
        </Card>
      )}

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
                    <li
                      key={fc.categoryId}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/transactions?category=${fc.categoryId}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/transactions?category=${fc.categoryId}`);
                        }
                      }}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 cursor-pointer"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: fc.categoryColor }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{fc.categoryName}</div>
                        <div className="text-xs text-muted-foreground">
                          {fc.items.length} item{fc.items.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="hidden flex-1 sm:block">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-slate-400"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right tabular-nums text-sm shrink-0">
                        <div>
                          <span className="font-medium">{formatCurrency(fc.spent)}</span>
                          <span className="text-muted-foreground">
                            {" / "}
                            {formatCurrency(fc.monthlyAmount)}
                          </span>
                        </div>
                      </div>
                    </li>
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

      <Dialog open={regenerateConfirmOpen} onOpenChange={setRegenerateConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace current suggestions?</DialogTitle>
            <DialogDescription>
              This will replace the {data.suggestions.length} pending suggestion
              {data.suggestions.length === 1 ? "" : "s"} with a fresh set based on
              the last {data.automation.lookbackMonths} month
              {data.automation.lookbackMonths === 1 ? "" : "s"} of spending. Any
              edits you&apos;ve made to the current suggestions will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenerateConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRegenerate} disabled={generateBudgets.isPending}>
              {generateBudgets.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function statusColor(status: Allocation["status"]): { bar: string; text: string } {
  if (status === "exceeded") {
    return { bar: "#ef4444", text: "text-red-600 dark:text-red-400" };
  }
  if (status === "warning") {
    return { bar: "#f59e0b", text: "text-amber-600 dark:text-amber-400" };
  }
  return { bar: "", text: "text-muted-foreground" };
}

interface AllocationRowProps {
  alloc: Allocation;
  isDeleteConfirming: boolean;
  readOnly?: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
}

function AllocationRow({
  alloc,
  isDeleteConfirming,
  readOnly = false,
  onClick,
  onEdit,
  onDelete,
  onAskDelete,
  onCancelDelete,
}: AllocationRowProps) {
  const colors = statusColor(alloc.status);
  const barColor = colors.bar || alloc.categoryColor || "#3b82f6";
  const remainingLabel =
    alloc.status === "exceeded"
      ? `${formatCurrency(alloc.spent - alloc.amount)} over`
      : `${formatCurrency(alloc.remaining)} left`;

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 cursor-pointer sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(140px,2fr)_auto_auto]"
    >
      {/* Color dot */}
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: alloc.categoryColor || "#94a3b8" }}
      />

      {/* Name + avg */}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{alloc.categoryName}</div>
        {alloc.avgMonthly > 0 && (
          <div className="truncate text-xs text-muted-foreground">
            avg {formatCurrency(alloc.avgMonthly)}/mo · {alloc.avgMonths} mo
          </div>
        )}
      </div>

      {/* Inline progress bar (desktop only) */}
      <div className="col-span-3 sm:col-span-1 sm:px-2 row-start-2 sm:row-start-auto">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(alloc.percentage, 100)}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
      </div>

      {/* Spent / Limit + status */}
      <div className="text-right tabular-nums text-sm row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto shrink-0">
        <div>
          <span className="font-medium">{formatCurrency(alloc.spent)}</span>
          <span className="text-muted-foreground">
            {" / "}
            {formatCurrency(alloc.amount)}
          </span>
        </div>
        <div className={`text-xs ${colors.text}`}>{remainingLabel}</div>
      </div>

      {/* Actions */}
      {!readOnly && (
      <div
        className="flex items-center gap-0.5 row-start-1 col-start-3 justify-end sm:row-start-auto sm:col-start-auto sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {isDeleteConfirming ? (
          <>
            <Button
              variant="destructive"
              size="icon"
              className="h-7 w-7"
              onClick={onDelete}
              aria-label="Confirm delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onCancelDelete}
              aria-label="Cancel delete"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onAskDelete}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>
      )}
    </li>
  );
}

interface SuggestionRowProps {
  suggestion: BudgetSuggestion;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}

function SuggestionRow({ suggestion, busy, onAccept, onReject }: SuggestionRowProps) {
  const isNew = suggestion.currentAmount === null;
  const delta = suggestion.currentAmount !== null ? suggestion.suggestedAmount - suggestion.currentAmount : null;
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 border-l-2 border-blue-400 bg-blue-50/40 px-4 py-2.5 dark:bg-blue-950/20 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(140px,2fr)_auto_auto]">
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: suggestion.categoryColor || "#3b82f6" }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{suggestion.categoryName}</span>
          <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <Sparkles className="h-2.5 w-2.5" />
            {isNew ? "New" : "Update"}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          avg {formatCurrency(suggestion.avgMonthly)}/mo · {suggestion.monthsOfData} mo
        </div>
      </div>
      <div className="hidden sm:block sm:px-2 text-xs text-muted-foreground">
        {suggestion.currentAmount !== null ? (
          <span>
            {formatCurrency(suggestion.currentAmount)} →{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(suggestion.suggestedAmount)}
            </span>
            {delta !== null && Math.abs(delta) >= 1 && (
              <span className={`ml-1 ${delta > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                ({delta > 0 ? "+" : ""}
                {formatCurrency(delta)})
              </span>
            )}
          </span>
        ) : (
          <span>
            Suggest{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(suggestion.suggestedAmount)}
            </span>
          </span>
        )}
      </div>
      <div className="text-right tabular-nums text-sm row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto shrink-0">
        <div className="font-medium">{formatCurrency(suggestion.suggestedAmount)}</div>
        <div className="text-xs text-muted-foreground">/mo</div>
      </div>
      <div className="flex items-center gap-1 row-start-1 col-start-3 justify-end sm:row-start-auto sm:col-start-auto">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          onClick={onReject}
          disabled={busy}
          aria-label="Dismiss suggestion"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" className="h-7 px-2" onClick={onAccept} disabled={busy} aria-label="Accept suggestion">
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
