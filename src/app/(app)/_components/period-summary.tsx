import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PotSaldoGraph } from "@/components/pot-saldo-graph";
import {
  getBudgetOverview,
  getMonthSummary,
  getSpendingSeries,
} from "../_lib/dashboard-queries";
import { formatFinancialMonthLabel } from "@/lib/financial-month";
import { formatCurrency, toIsoDate } from "@/lib/utils";

export async function PeriodSummary({
  userId,
  startDay = 1,
  accountId,
}: {
  userId: string;
  startDay?: number;
  accountId?: string;
}) {
  const [budget, summary, spending] = await Promise.all([
    getBudgetOverview(userId, startDay),
    getMonthSummary(userId, startDay, accountId),
    getSpendingSeries(userId, startDay),
  ]);

  const monthLabel = formatFinancialMonthLabel(new Date(), startDay);
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endMs = new Date(`${spending.monthEnd}T00:00:00`).getTime();
  const daysLeft = Math.max(0, Math.round((endMs - todayMs) / 86400000) + 1);

  const hasBudget = budget.totalBudgeted > 0;
  const left = budget.totalBudgeted - budget.totalBudgetSpent;
  const pct = hasBudget
    ? Math.round((budget.totalBudgetSpent / budget.totalBudgeted) * 100)
    : 0;
  const over = hasBudget && left < 0;
  const perDay = !over && daysLeft > 0 ? left / daysLeft : 0;
  const net = summary.monthIncome - summary.monthExpenses;

  // Linear budget pace: 0 at period start → total budget at period end,
  // one point per day so the stepwise renderer approximates a straight line.
  let expectedSeries: { date: string; value: number }[] | undefined;
  if (hasBudget) {
    const startMs = new Date(`${spending.monthStart}T00:00:00`).getTime();
    const totalDays = Math.round((endMs - startMs) / 86400000) + 1;
    expectedSeries = [];
    const cursor = new Date(`${spending.monthStart}T00:00:00`);
    for (let i = 0; i < totalDays; i++) {
      expectedSeries.push({
        date: toIsoDate(cursor),
        value: (budget.totalBudgeted * (i + 1)) / totalDays,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
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

        <div className="mt-4 grid gap-6 lg:grid-cols-2 lg:items-end">
          <div className="min-w-0">
            {hasBudget ? (
              <>
                <p
                  className={`text-5xl font-bold tracking-tight ${
                    over ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {formatCurrency(Math.abs(left))}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {over ? (
                    <>over budget this period</>
                  ) : (
                    <>
                      left to spend
                      {perDay > 0 && (
                        <> · about {formatCurrency(perDay)} per day</>
                      )}
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatCurrency(budget.totalBudgetSpent)} of{" "}
                  {formatCurrency(budget.totalBudgeted)} budget used ({pct}%)
                </p>
              </>
            ) : (
              <>
                <p className="text-5xl font-bold tracking-tight">
                  {formatCurrency(summary.monthExpenses)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  spent this period ·{" "}
                  <Link href="/budgets" className="text-primary hover:underline">
                    set budgets
                  </Link>{" "}
                  to see what&apos;s left
                </p>
              </>
            )}

            <div className="mt-5 grid grid-cols-3 gap-4 border-t pt-4">
              <div>
                <p className="text-xs text-muted-foreground">Earned</p>
                <p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(summary.monthIncome)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Spent</p>
                <p className="text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {formatCurrency(summary.monthExpenses)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net</p>
                <p
                  className={`text-lg font-semibold tabular-nums ${
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

          <div className="min-w-0">
            <PotSaldoGraph
              series={spending.series}
              expectedSeries={expectedSeries}
              target={hasBudget ? budget.totalBudgeted : undefined}
              today={spending.today}
              showPoints={false}
              ariaLabel="Cumulative spending this period against the budget pace"
            />
            {hasBudget && (
              <p className="mt-1 text-xs text-muted-foreground">
                Solid: spending so far · dashed: on-pace spending toward the{" "}
                {formatCurrency(budget.totalBudgeted, "EUR", 0)} budget
              </p>
            )}
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
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <Skeleton className="h-12 w-48" />
            <Skeleton className="mt-2 h-4 w-56" />
            <Skeleton className="mt-1.5 h-3 w-44" />
            <div className="mt-5 grid grid-cols-3 gap-4 border-t pt-4">
              {[1, 2, 3].map((i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-12 mb-1.5" />
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-[220px] w-full rounded-lg" />
        </div>
      </CardContent>
    </Card>
  );
}
