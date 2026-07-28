import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BudgetRing } from "@/components/budget-ring";
import { getBudgetOverview, getMonthSummary } from "../_lib/dashboard-queries";
import {
  formatFinancialMonthLabel,
  getFinancialMonthRange,
} from "@/lib/financial-month";
import { formatCurrency } from "@/lib/utils";

export async function PeriodSummary({
  userId,
  startDay = 1,
  accountId,
}: {
  userId: string;
  startDay?: number;
  accountId?: string;
}) {
  const [budget, summary] = await Promise.all([
    getBudgetOverview(userId, startDay),
    getMonthSummary(userId, startDay, accountId),
  ]);

  const monthLabel = formatFinancialMonthLabel(new Date(), startDay);
  const now = new Date();
  const period = getFinancialMonthRange(now, startDay);
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endMs = new Date(`${period.to}T00:00:00`).getTime();
  const daysLeft = Math.max(0, Math.round((endMs - todayMs) / 86400000) + 1);

  const hasBudget = budget.totalBudgeted > 0;
  const left = budget.totalBudgeted - budget.totalBudgetSpent;
  const pct = hasBudget
    ? Math.round((budget.totalBudgetSpent / budget.totalBudgeted) * 100)
    : 0;
  const over = hasBudget && left < 0;
  const perDay = !over && daysLeft > 0 ? left / daysLeft : 0;
  const net = summary.monthIncome - summary.monthExpenses;

  // Link the Earned/Spent tiles to the same financial period on /transactions.
  const txHref = (type: "income" | "expense") => {
    const p = new URLSearchParams({
      type,
      dateFrom: period.from,
      dateTo: period.to,
    });
    if (accountId) p.set("account", accountId);
    return `/transactions?${p}`;
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            {monthLabel}
            <span className="text-muted-foreground font-normal">
              {" "}· {daysLeft} day{daysLeft === 1 ? "" : "s"} left
            </span>
          </p>
          <Link
            href="/budgets"
            className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded flex items-center gap-0.5 shrink-0"
          >
            All budgets <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-2 flex flex-col items-center">
          <BudgetRing
            half
            thickness={8}
            className="w-full max-w-[300px]"
            total={hasBudget ? budget.totalBudgeted : 0}
            segments={[
              {
                label: "Spent",
                value: budget.totalBudgetSpent,
                color: over
                  ? "var(--color-destructive)"
                  : pct >= 85
                    ? "var(--color-warning)"
                    : "var(--color-primary)",
              },
            ]}
          >
            <p
              className={`text-3xl sm:text-4xl font-bold tracking-tight tabular-nums ${
                over ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {formatCurrency(hasBudget ? Math.abs(left) : summary.monthExpenses)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasBudget
                ? over
                  ? "over budget"
                  : "left to spend"
                : "spent this period"}
            </p>
          </BudgetRing>

          {hasBudget ? (
            <div className="mt-2 text-center">
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatCurrency(budget.totalBudgetSpent)} of{" "}
                {formatCurrency(budget.totalBudgeted)} used ({pct}%)
              </p>
              {perDay > 0 && (
                <p className="text-xs text-muted-foreground">
                  about {formatCurrency(perDay)} per day for {daysLeft} more day
                  {daysLeft === 1 ? "" : "s"}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground text-center">
              <Link href="/budgets" className="text-primary hover:underline">
                Set budgets
              </Link>{" "}
              to see what&apos;s left
            </p>
          )}

          {/* Amounts are unbreakable, so the tiles shrink with the viewport
              instead of spilling out of their grid track. */}
          <div className="mt-5 grid w-full grid-cols-3 gap-2 border-t pt-4 sm:gap-4">
            <Link
              href={txHref("income")}
              className="min-w-0 rounded hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs text-muted-foreground">Earned</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(summary.monthIncome)}
              </p>
            </Link>
            <Link
              href={txHref("expense")}
              className="min-w-0 rounded hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs text-muted-foreground">Spent</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                {formatCurrency(summary.monthExpenses)}
              </p>
            </Link>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Net</p>
              <p
                className={`text-base sm:text-lg font-semibold tabular-nums ${
                  net >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {formatCurrency(net)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PeriodSummarySkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-baseline justify-between">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="mt-4 flex flex-col items-center">
          <Skeleton className="h-[150px] w-full max-w-[300px] rounded-lg" />
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-1.5 h-3 w-44" />
          <div className="mt-5 grid w-full grid-cols-3 gap-4 border-t pt-4">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <Skeleton className="h-3 w-12 mb-1.5" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
