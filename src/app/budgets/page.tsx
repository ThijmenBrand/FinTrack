"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Lock,
  Coins,
} from "lucide-react";
import { BudgetHistoryDialog } from "@/components/budget-history-dialog";

interface FixedCost {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  monthlyAmount: number;
  spent: number;
  avgMonthly: number;
  avgMonths: number;
  items: { description: string; monthlyAmount: number }[];
}

interface Allocation {
  id: string;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  amount: number;
  spent: number;
  remaining: number;
  percentage: number;
  status: "ok" | "warning" | "exceeded";
  avgMonthly: number;
  avgMonths: number;
}

interface BudgetData {
  monthlyIncome: number;
  totalFixedCosts: number;
  availableToAllocate: number;
  totalAllocated: number;
  unallocated: number;
  fixedCosts: FixedCost[];
  allocations: Allocation[];
  categoryAverages: Record<string, number>;
  month: { from: string; to: string; label: string };
}

interface Category {
  id: string;
  name: string;
  color: string | null;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export default function BudgetsPage() {
  const router = useRouter();
  const [data, setData] = useState<BudgetData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlloc, setEditingAlloc] = useState<Allocation | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [historyAlloc, setHistoryAlloc] = useState<Allocation | null>(null);

  // Form
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formAmount, setFormAmount] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [bRes, cRes] = await Promise.all([
        fetch("/api/budgets"),
        fetch("/api/categories"),
      ]);
      if (bRes.ok) {
        setData(await bRes.json());
      } else {
        console.error("Budget API error:", bRes.status);
      }
      if (cRes.ok) {
        setCategories(await cRes.json());
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

    if (editingAlloc) {
      await fetch("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingAlloc.id, amount }),
      });
    } else {
      await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: formCategoryId, amount }),
      });
    }

    setDialogOpen(false);
    resetForm();
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/budgets?id=${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    fetchData();
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Budget</h1>
          <p className="text-muted-foreground">
            {data.month.label} &mdash; allocate your income across spending
            categories.
          </p>
        </div>
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
              Add Allocation
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
                  <Select
                    value={formCategoryId}
                    onValueChange={setFormCategoryId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{
                                backgroundColor: cat.color || "#94a3b8",
                              }}
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
      </div>

      {/* Budget Overview Bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Budget Overview</CardTitle>
          <CardDescription>
            How your {formatCurrency(data.monthlyIncome)} monthly income is
            distributed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stacked bar */}
          <div className="h-8 rounded-full bg-muted overflow-hidden flex">
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
          {/* Legend */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-slate-400" />
              Fixed costs: {formatCurrency(data.totalFixedCosts)}{" "}
              <span className="text-muted-foreground">
                ({fixedPct.toFixed(0)}%)
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-blue-500" />
              Allocated: {formatCurrency(data.totalAllocated)}{" "}
              <span className="text-muted-foreground">
                ({allocatedPct.toFixed(0)}%)
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-emerald-400/40" />
              Unallocated: {formatCurrency(Math.max(0, data.unallocated))}{" "}
              <span className="text-muted-foreground">
                ({Math.max(0, unallocatedPct).toFixed(0)}%)
              </span>
            </span>
          </div>
          {data.unallocated < 0 && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4" />
              You&apos;ve over-allocated by{" "}
              {formatCurrency(Math.abs(data.unallocated))}. Reduce some
              allocations or increase income.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Monthly Income
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(data.monthlyIncome)}
            </div>
            <p className="text-xs text-muted-foreground">
              From {data.fixedCosts.length > 0 ? "recurring payments" : "no recurring income set up"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fixed Costs</CardTitle>
            <Lock className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(data.totalFixedCosts)}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.fixedCosts.length} recurring expense categor
              {data.fixedCosts.length !== 1 ? "ies" : "y"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Available to Budget
            </CardTitle>
            <Coins className="h-4 w-4 text-blue-500 dark:text-blue-400" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${data.unallocated >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
            >
              {formatCurrency(Math.max(0, data.unallocated))}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.unallocated >= 0
                ? "Still available to allocate"
                : "Over-allocated"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Variable Spending Allocations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-500 dark:text-blue-400" />
            Spending Allocations
          </CardTitle>
          <CardDescription>
            How you want to distribute your remaining{" "}
            {formatCurrency(data.availableToAllocate)} across variable spending
            categories.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.allocations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Coins className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground max-w-sm">
                No allocations yet. Click &quot;Add Allocation&quot; to start
                distributing your budget across spending categories like
                Groceries, Dining Out, Shopping, etc.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.allocations.map((alloc) => {
                const barColor =
                  alloc.status === "exceeded"
                    ? "#ef4444"
                    : alloc.status === "warning"
                      ? "#f59e0b"
                      : alloc.categoryColor || "#3b82f6";

                const StatusIcon =
                  alloc.status === "exceeded"
                    ? XCircle
                    : alloc.status === "warning"
                      ? AlertTriangle
                      : CheckCircle;

                const statusColor =
                  alloc.status === "exceeded"
                    ? "text-red-500 dark:text-red-400"
                    : alloc.status === "warning"
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-green-500 dark:text-green-400";

                return (
                  <div
                    key={alloc.id}
                    className="rounded-lg border p-3 group relative cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setHistoryAlloc(alloc)}
                  >
                    <div
                      className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg"
                      style={{
                        backgroundColor: alloc.categoryColor || "#94a3b8",
                      }}
                    />
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor:
                                alloc.categoryColor || "#94a3b8",
                            }}
                          />
                          <span className="font-medium text-sm">
                            {alloc.categoryName}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => openEdit(alloc)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {deleteConfirm === alloc.id ? (
                          <div className="flex gap-0.5">
                            <Button
                              variant="destructive"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleDelete(alloc.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setDeleteConfirm(null)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setDeleteConfirm(alloc.id)}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* Progress */}
                    <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(alloc.percentage, 100)}%`,
                          backgroundColor: barColor,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-semibold">
                          {formatCurrency(alloc.spent)}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          / {formatCurrency(alloc.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <StatusIcon
                          className={`h-3.5 w-3.5 ${statusColor}`}
                        />
                        <span
                          className={`text-xs font-medium ${statusColor}`}
                        >
                          {alloc.remaining > 0
                            ? `${formatCurrency(alloc.remaining)} left`
                            : alloc.status === "exceeded"
                              ? `${formatCurrency(alloc.spent - alloc.amount)} over`
                              : "On track"}
                        </span>
                      </div>
                    </div>
                    {alloc.avgMonthly > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Avg. {formatCurrency(alloc.avgMonthly)}/mo
                        <span className="opacity-60"> ({alloc.avgMonths} mo)</span>
                        {Math.abs(alloc.amount - alloc.avgMonthly) > 1 && (
                          <span className={alloc.amount >= alloc.avgMonthly ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"}>
                            {" \u2014 "}
                            {alloc.amount >= alloc.avgMonthly
                              ? `${formatCurrency(alloc.amount - alloc.avgMonthly)} buffer`
                              : `${formatCurrency(alloc.avgMonthly - alloc.amount)} under avg`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fixed Costs (auto from recurring) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-slate-400" />
            Fixed Costs
          </CardTitle>
          <CardDescription>
            Automatically populated from your recurring expenses. Manage these
            on the Recurring page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.fixedCosts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No recurring expenses set up yet. Add them on the{" "}
              <a href="/recurring" className="text-primary underline">
                Recurring
              </a>{" "}
              page.
            </p>
          ) : (
            <div className="space-y-2">
              {data.fixedCosts.map((fc) => (
                <div
                  key={fc.categoryId}
                  className="rounded-lg border p-3 space-y-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => router.push(`/transactions?category=${fc.categoryId}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: fc.categoryColor }}
                      />
                      <span className="font-medium text-sm">
                        {fc.categoryName}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-sm">
                        {formatCurrency(fc.monthlyAmount)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        /mo
                      </span>
                    </div>
                  </div>
                  {/* Show individual items */}
                  <div className="pl-5 space-y-0.5">
                    {fc.items.map((item, i) => (
                      <div
                        key={i}
                        className="flex justify-between text-xs text-muted-foreground"
                      >
                        <span>{item.description}</span>
                        <span>{formatCurrency(item.monthlyAmount)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Spending bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-slate-400"
                        style={{
                          width: `${Math.min(100, fc.monthlyAmount > 0 ? (fc.spent / fc.monthlyAmount) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-20 text-right">
                      {formatCurrency(fc.spent)} spent
                    </span>
                  </div>
                  {fc.avgMonthly > 0 && (
                    <div className="text-xs text-muted-foreground pl-5">
                      Avg. {formatCurrency(fc.avgMonthly)}/mo
                      <span className="opacity-60"> (based on {fc.avgMonths} month{fc.avgMonths !== 1 ? "s" : ""})</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <BudgetHistoryDialog
        allocation={historyAlloc}
        onOpenChange={(open) => { if (!open) setHistoryAlloc(null); }}
      />
    </div>
  );
}
