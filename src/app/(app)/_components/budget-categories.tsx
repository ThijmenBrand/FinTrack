import Link from "next/link";
import { ArrowRight, PiggyBank } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionsFilterLink } from "@/components/transactions-filter-link";
import { getBudgetOverview } from "../_lib/dashboard-queries";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { formatCurrency } from "@/lib/utils";

// Mobile stacks each row onto two lines — name · delta, then bar · spent/budget.
// The trailing columns are fixed widths on desktop so the bars line up instead
// of being sized by however long each amount happens to be.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-4 py-2.5 sm:grid-cols-[minmax(0,13.5rem)_minmax(96px,1fr)_7rem_8.5rem]";

export async function BudgetCategories({
  userId,
  startDay = 1,
}: {
  userId: string;
  startDay?: number;
}) {
  const data = await getBudgetOverview(userId, startDay);
  const fmRange =
    startDay === 1 ? null : getFinancialMonthRange(new Date(), startDay);
  const pacePct = Math.round(data.monthProgress * 100);

  const filterProps = {
    period: fmRange ? undefined : ("this-month" as const),
    dateFrom: fmRange?.from,
    dateTo: fmRange?.to,
  };

  if (data.budgetItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <PiggyBank className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground max-w-sm">
              Give each spending category a budget and this card shows exactly
              how much you have left for groceries, dining out, and the rest.
            </p>
            <Link
              href="/budgets"
              className="mt-3 text-sm text-primary hover:underline"
            >
              Set up budgets
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Left per category</CardTitle>
          <Link
            href="/budgets"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            Manage <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <CardDescription>
          The tick on each bar is today, {pacePct}% through the period
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <ul>
          {data.budgetItems.map((item, i) => {
            const over = item.status === "exceeded";
            const barClass = over
              ? "bg-red-500"
              : item.status === "warning"
                ? "bg-amber-500"
                : "bg-emerald-500";
            const left = item.limit - item.spent;

            const row = (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {item.categoryName || "Uncategorized"}
                  </span>
                  {/* Non-monthly budgets run on their own clock, so the
                      period tick below doesn't apply to them — say so. */}
                  {item.period !== "monthly" && (
                    <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-semibold text-muted-foreground">
                      {item.period}
                    </span>
                  )}
                </div>
                <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1">
                  <div
                    className="relative h-1.5 rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.min(item.percentage, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${item.categoryName ?? "Category"}: ${item.percentage}% of budget used`}
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                      style={{ width: `${Math.min(item.percentage, 100)}%` }}
                    />
                    {item.period === "monthly" && (
                      <span
                        className="absolute -top-[3px] -bottom-[3px] w-0.5 rounded-full bg-foreground/35"
                        style={{ left: `${pacePct}%` }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>
                <span
                  className={`col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums sm:col-start-3 ${
                    over
                      ? "text-red-600 dark:text-red-400"
                      : item.status === "warning"
                        ? "text-amber-600 dark:text-amber-400"
                        : ""
                  }`}
                >
                  {over
                    ? `${formatCurrency(-left)} over`
                    : `${formatCurrency(left)} left`}
                </span>
                <span className="col-start-2 row-start-2 text-right text-xs text-muted-foreground tabular-nums sm:col-start-4 sm:row-start-1">
                  {formatCurrency(item.spent)} / {formatCurrency(item.limit)}
                </span>
              </>
            );

            return (
              <li key={item.categoryId ?? i}>
                {item.categoryId ? (
                  <TransactionsFilterLink
                    category={item.categoryId}
                    {...filterProps}
                    className={`${ROW} transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                  >
                    {row}
                  </TransactionsFilterLink>
                ) : (
                  <div className={ROW}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>

        {data.unbudgetedItems.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <div className="flex items-baseline justify-between gap-2 px-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Not budgeted
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(data.unbudgetedTotal)}
              </span>
            </div>
            <p className="px-4 pb-1 text-xs text-muted-foreground">
              Counted in the total above, but not in any budget
            </p>
            {/* Two columns: these are bare name/amount pairs, so a single
                column would leave half the card empty on desktop. */}
            <ul className="grid px-4 sm:grid-cols-2 sm:gap-x-6">
              {data.unbudgetedItems.map((item, i) => {
                const row = (
                  <>
                    <span className="truncate text-sm">
                      {item.categoryName || "Uncategorized"}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">
                      {formatCurrency(item.spent)}
                    </span>
                  </>
                );
                const rowClass =
                  "flex items-baseline justify-between gap-3 rounded-md -mx-2 px-2 py-1";
                return (
                  <li key={item.categoryId ?? `x${i}`}>
                    {item.categoryId ? (
                      <TransactionsFilterLink
                        category={item.categoryId}
                        {...filterProps}
                        className={`${rowClass} transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                      >
                        {row}
                      </TransactionsFilterLink>
                    ) : (
                      <div className={rowClass}>{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Link
              href="/budgets"
              className="mt-1 inline-flex items-center gap-0.5 px-4 text-xs text-primary hover:underline"
            >
              Set budgets for these{" "}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BudgetCategoriesSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-64 mt-1" />
      </CardHeader>
      <CardContent className="px-6 pb-4 space-y-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-32 shrink-0" />
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
