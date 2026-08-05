"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { BudgetData } from "@/types/api";

function daysLeftInMonth(toDate: string): number {
  const end = new Date(toDate + "T23:59:59");
  const now = new Date();
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function isPastRange(toDate: string): boolean {
  return new Date(toDate + "T23:59:59").getTime() < Date.now();
}

interface BudgetPerformanceProps {
  data: BudgetData | null;
  /** Set when the page filters spending to specific accounts; budget caps still span all accounts. */
  accountLabel?: string;
}

export function BudgetPerformance({ data, accountLabel }: BudgetPerformanceProps) {
  if (!data) return null;

  const hasAnyBudget =
    data.totalBudget > 0 ||
    data.allocations.length > 0 ||
    data.fixedCosts.length > 0;

  if (!hasAnyBudget) return null;

  const { totalBudget, totalSpentThisMonth, unbudgetedSpending } = data;

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
  const biggestUnbudgeted = [...unbudgetedSpending].sort(
    (a, b) => b.spent - a.spent,
  )[0];

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

  const pastRange = isPastRange(data.month.to);
  const daysLeft = pastRange ? 0 : daysLeftInMonth(data.month.to);

  return (
    <Card className={isOver ? "border-red-300 dark:border-red-900/60" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Budget Performance</CardTitle>
            <CardDescription>
              {data.month.label}
              {!pastRange && (
                <> · {daysLeft} day{daysLeft === 1 ? "" : "s"} left</>
              )}
              {accountLabel && <> · spending from {accountLabel}</>}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline status — one line, no colored box: the number carries the tone. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className={`text-xl font-semibold tabular-nums ${
              isOver
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {formatCurrency(Math.abs(remaining))}{" "}
            {isOver ? "over budget" : "under budget"}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            spent {formatCurrency(totalSpentThisMonth)} of{" "}
            {formatCurrency(totalBudget)}
            {totalBudget > 0 && ` · ${pctOfBudget}%`}
          </span>
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
            {/* The per-category detail lives in "Where your money went", which
                flags these same categories — this is just the way to act on it. */}
            {biggestUnbudgeted && (
              <Link
                href="/budgets"
                className="inline-flex items-center gap-1 text-primary hover:underline sm:ml-auto"
              >
                Set budget for {biggestUnbudgeted.categoryName}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
