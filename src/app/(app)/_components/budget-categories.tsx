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
import { CategoryIcon } from "@/components/category-icon";
import { getBudgetOverview } from "../_lib/dashboard-queries";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { formatCurrency } from "@/lib/utils";

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
          The marker on each bar is today, {pacePct}% through the period
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <ul>
          {data.budgetItems.map((item, i) => {
            const over = item.status === "exceeded";
            const fillColor = over
              ? "var(--color-destructive)"
              : item.status === "warning"
                ? "var(--color-warning)"
                : item.categoryColor || "var(--color-primary)";
            const leftAmount = Math.max(0, item.limit - item.spent);

            const row = (
              <>
                <CategoryIcon
                  icon={item.categoryIcon}
                  color={item.categoryColor || "#94a3b8"}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {item.categoryName || "Uncategorized"}
                    </span>
                    <span
                      className={`text-sm font-semibold tabular-nums shrink-0 ${
                        over
                          ? "text-red-600 dark:text-red-400"
                          : item.status === "warning"
                            ? "text-amber-600 dark:text-amber-400"
                            : ""
                      }`}
                    >
                      {over
                        ? `${formatCurrency(item.spent - item.limit)} over`
                        : `${formatCurrency(leftAmount)} left`}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div
                      className="relative h-1.5 flex-1 rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={Math.min(item.percentage, 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${item.categoryName ?? "Category"}: ${item.percentage}% of budget used`}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(item.percentage, 100)}%`,
                          backgroundColor: fillColor,
                        }}
                      />
                      {item.period === "monthly" && (
                        <span
                          className="absolute -top-[3px] -bottom-[3px] w-0.5 rounded-full bg-foreground/35"
                          style={{ left: `${pacePct}%` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <span className="w-32 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(item.spent)} / {formatCurrency(item.limit)}
                    </span>
                  </div>
                </div>
              </>
            );

            const rowClass =
              "flex items-start gap-3 rounded-lg px-4 py-2.5";

            return (
              <li key={item.categoryId ?? i}>
                {item.categoryId ? (
                  <TransactionsFilterLink
                    category={item.categoryId}
                    period={fmRange ? undefined : "this-month"}
                    dateFrom={fmRange?.from}
                    dateTo={fmRange?.to}
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

        {data.unbudgetedItems.length > 0 && (
          <div className="mt-2 border-t pt-3">
            <div className="flex items-baseline justify-between gap-2 px-4">
              <span className="text-sm font-medium">Not budgeted</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(data.unbudgetedTotal)}
              </span>
            </div>
            <p className="px-4 pb-1 text-xs text-muted-foreground">
              Counted in the total at the top, but not in any budget above
            </p>
            <ul>
              {data.unbudgetedItems.map((item, i) => {
                const row = (
                  <>
                    <CategoryIcon
                      icon={item.categoryIcon}
                      color={item.categoryColor || "#94a3b8"}
                      size="sm"
                    />
                    <span className="truncate text-sm flex-1">
                      {item.categoryName || "Uncategorized"}
                    </span>
                    <span className="text-sm tabular-nums shrink-0">
                      {formatCurrency(item.spent)}
                    </span>
                  </>
                );
                const rowClass =
                  "flex items-center gap-3 rounded-lg px-4 py-1.5";
                return (
                  <li key={item.categoryId ?? `x${i}`}>
                    {item.categoryId ? (
                      <TransactionsFilterLink
                        category={item.categoryId}
                        period={fmRange ? undefined : "this-month"}
                        dateFrom={fmRange?.from}
                        dateTo={fmRange?.to}
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
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-6 w-6 rounded-full shrink-0" />
            <div className="flex-1">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
