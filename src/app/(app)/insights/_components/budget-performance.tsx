"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, TrendingDown, ArrowRight, PiggyBank } from "lucide-react";
import type { BudgetData } from "@/types/api";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function daysLeftInMonth(toDate: string): number {
  const end = new Date(toDate + "T23:59:59");
  const now = new Date();
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

interface BudgetPerformanceProps {
  data: BudgetData | null;
}

export function BudgetPerformance({ data }: BudgetPerformanceProps) {
  const router = useRouter();

  if (!data) return null;

  const hasAnyBudget =
    data.totalBudget > 0 ||
    data.allocations.length > 0 ||
    data.fixedCosts.length > 0 ||
    (data.reserved?.length ?? 0) > 0;

  if (!hasAnyBudget) return null;

  const { totalBudget, totalSpentThisMonth, unbudgetedSpending } = data;
  const reserved = data.reserved ?? [];
  const totalReserved = data.totalReserved ?? 0;

  // Budgeted spending split into within-cap and over-cap parts
  let withinBudget = 0;
  let overBudgetOnTracked = 0;
  for (const a of data.allocations) {
    withinBudget += Math.min(a.spent, a.amount);
    overBudgetOnTracked += Math.max(0, a.spent - a.amount);
  }
  for (const fc of data.fixedCosts) {
    withinBudget += Math.min(fc.spent, fc.monthlyAmount);
    overBudgetOnTracked += Math.max(0, fc.spent - fc.monthlyAmount);
  }
  const unbudgetedTotal = unbudgetedSpending.reduce((s, c) => s + c.spent, 0);

  const remaining = totalBudget - totalSpentThisMonth;
  const isOver = remaining < 0;
  const pctOfBudget = totalBudget > 0
    ? Math.round((totalSpentThisMonth / totalBudget) * 100)
    : 0;

  // Bar reference: scale to whichever is larger so over-spending is visible
  const reference = Math.max(totalBudget, totalSpentThisMonth, 1);
  const withinPct = (withinBudget / reference) * 100;
  const overPct = (overBudgetOnTracked / reference) * 100;
  const unbudgetedPct = (unbudgetedTotal / reference) * 100;
  const budgetMarkerPct = (totalBudget / reference) * 100;

  const daysLeft = daysLeftInMonth(data.month.to);

  const navigateToCategory = (categoryId: string) => {
    const params = new URLSearchParams();
    params.set("category", categoryId);
    params.set("period", "this-month");
    router.push(`/transactions?${params.toString()}`);
  };

  return (
    <Card className={isOver ? "border-red-300 dark:border-red-900/60" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Monthly Budget Performance</CardTitle>
            <CardDescription>
              {data.month.label} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline status */}
        <div
          className={`rounded-lg px-4 py-3 ${
            isOver
              ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
              : "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          <div className="flex items-start gap-3">
            {isOver ? (
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
            ) : (
              <TrendingDown className="h-5 w-5 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-2xl font-bold">
                {formatCurrency(Math.abs(remaining))}{" "}
                <span className="text-sm font-medium">
                  {isOver ? "over budget" : "under budget"}
                </span>
              </div>
              <div className="text-sm opacity-90">
                Spent {formatCurrency(totalSpentThisMonth)} of{" "}
                {formatCurrency(totalBudget)}
                {totalBudget > 0 && ` (${pctOfBudget}%)`}
              </div>
            </div>
          </div>
        </div>

        {/* Stacked progress bar */}
        <div className="space-y-2">
          <div className="relative h-3 rounded-full bg-muted overflow-hidden flex">
            {withinPct > 0 && (
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${withinPct}%` }}
                title={`Within budget: ${formatCurrency(withinBudget)}`}
              />
            )}
            {overPct > 0 && (
              <div
                className="h-full bg-amber-500 transition-all duration-500"
                style={{ width: `${overPct}%` }}
                title={`Over budget on tracked categories: ${formatCurrency(overBudgetOnTracked)}`}
              />
            )}
            {unbudgetedPct > 0 && (
              <div
                className="h-full bg-red-500 transition-all duration-500"
                style={{ width: `${unbudgetedPct}%` }}
                title={`Unbudgeted spending: ${formatCurrency(unbudgetedTotal)}`}
              />
            )}
            {budgetMarkerPct < 100 && totalSpentThisMonth > totalBudget && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-foreground/70"
                style={{ left: `${budgetMarkerPct}%` }}
                title={`Budget limit: ${formatCurrency(totalBudget)}`}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" />
              Within budget {formatCurrency(withinBudget)}
            </span>
            {overBudgetOnTracked > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-amber-500" />
                Over on tracked {formatCurrency(overBudgetOnTracked)}
              </span>
            )}
            {unbudgetedTotal > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-red-500" />
                Unbudgeted {formatCurrency(unbudgetedTotal)}
              </span>
            )}
          </div>
        </div>

        {/* Reserved (savings / set-aside) — separate from spending budgets */}
        {totalReserved > 0 && (
          <div className="flex items-start gap-3 pt-2 border-t">
            <PiggyBank className="h-4 w-4 mt-0.5 text-blue-500 dark:text-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium">
                Reserved {formatCurrency(totalReserved)}
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  this month across {reserved.length} categor{reserved.length === 1 ? "y" : "ies"}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set aside off Free to Spend, not part of spending totals.
              </p>
            </div>
          </div>
        )}

        {/* Unbudgeted leakage list */}
        {unbudgetedSpending.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Spending without a budget</h3>
              <span className="text-xs text-muted-foreground">
                {unbudgetedSpending.length} categor
                {unbudgetedSpending.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <ul className="space-y-1">
              {unbudgetedSpending.map((cat) => (
                <li key={cat.categoryId}>
                  <button
                    type="button"
                    onClick={() => navigateToCategory(cat.categoryId)}
                    className="w-full flex items-center justify-between gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: cat.categoryColor }}
                      />
                      <span className="text-sm truncate">{cat.categoryName}</span>
                    </div>
                    <span className="text-sm font-medium tabular-nums shrink-0">
                      {formatCurrency(cat.spent)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link
              href="/budgets"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline pt-1"
            >
              Set budgets for these
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
