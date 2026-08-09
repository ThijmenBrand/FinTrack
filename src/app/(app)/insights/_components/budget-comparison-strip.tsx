"use client";

import { useQueries } from "@tanstack/react-query";
import { Star } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import type { BudgetOverview } from "@/app/(app)/_lib/dashboard-queries";
import type { BudgetPlanData } from "@/types/api";

interface BudgetComparisonStripProps {
  plans: BudgetPlanData[];
  /** Clicking a budget row jumps to that budget's analysis tab. */
  onSelect: (planId: string) => void;
}

/**
 * The Overall tab's answer to "how is each budget doing right now": one
 * spent-vs-budgeted bar per plan for the current period. Always current-month
 * data — the page's date preset filters transactions, not budget standing.
 */
export function BudgetComparisonStrip({ plans, onSelect }: BudgetComparisonStripProps) {
  const results = useQueries({
    queries: plans.map((p) => ({
      queryKey: ["dashboard-budget-overview", p.id],
      queryFn: () =>
        apiFetch<BudgetOverview>(`/api/dashboard/budget-overview?budgetId=${p.id}`),
      staleTime: 60 * 1000,
    })),
  });

  if (plans.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Budgets this period</CardTitle>
        <CardDescription>
          Spent against each budget&apos;s total (fixed costs + allocations) for
          the current period. Click one for its full analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {plans.map((plan, i) => {
          const overview = results[i]?.data;
          if (!overview) {
            return <Skeleton key={plan.id} className="h-12 w-full" />;
          }
          const spent = overview.totalBudgetSpent;
          const budgeted = overview.totalBudgeted;
          const over = budgeted > 0 && spent > budgeted;
          const scale = Math.max(spent, budgeted, 1);
          const limitPct = (budgeted / scale) * 100;
          const spentPct = (spent / scale) * 100;
          const pct = budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0;

          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => onSelect(plan.id)}
              className="grid w-full grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{plan.name}</span>
                {plan.isMain && (
                  <Star
                    className="h-3 w-3 shrink-0 fill-current text-amber-500"
                    aria-label="Main budget"
                  />
                )}
              </span>
              <span className="relative block h-2 rounded-full bg-muted max-sm:col-span-2 max-sm:row-start-2">
                <span className="absolute inset-0 overflow-hidden rounded-full">
                  <span
                    className={`block h-full ${
                      over || (budgeted > 0 && spent / budgeted >= 0.8)
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${over ? limitPct : spentPct}%` }}
                  />
                  {over && (
                    <span
                      className="absolute inset-y-0 bg-red-500"
                      style={{ left: `${limitPct}%`, width: `${spentPct - limitPct}%` }}
                    />
                  )}
                </span>
                {over && (
                  <span
                    className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-foreground"
                    style={{ left: `${limitPct}%` }}
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {budgeted > 0 ? (
                  <>
                    <span
                      className={`font-semibold ${
                        over
                          ? "text-red-600 dark:text-red-400"
                          : "text-foreground"
                      }`}
                    >
                      {formatCurrency(spent)}
                    </span>{" "}
                    / {formatCurrency(budgeted)} · {pct}%
                  </>
                ) : (
                  <>{formatCurrency(spent)} spent · no budget set</>
                )}
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
