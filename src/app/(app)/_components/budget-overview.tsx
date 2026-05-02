import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionsFilterLink } from "@/components/transactions-filter-link";
import { getBudgetOverview, formatCurrency } from "../_lib/dashboard-queries";
import {
  formatFinancialMonthLabel,
  getFinancialMonthRange,
} from "@/lib/financial-month";

function RingProgress({
  percentage,
  size,
  strokeWidth,
  color,
  trackColor = "var(--ring-progress-track, #e5e7eb)",
  ariaLabel,
}: {
  percentage: number;
  size: number;
  strokeWidth: number;
  color: string;
  trackColor?: string;
  ariaLabel?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(percentage, 100) / 100) * circ;
  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 -rotate-90"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

export async function BudgetOverview({
  userId,
  startDay = 1,
}: {
  userId: string;
  startDay?: number;
}) {
  const data = await getBudgetOverview(userId, startDay);

  if (data.budgetItems.length === 0 && data.totalBudgeted === 0) return null;

  const monthLabel = formatFinancialMonthLabel(new Date(), startDay);
  const periodCopy = startDay === 1 ? "this month" : "this period";
  const fmRange = startDay === 1 ? null : getFinancialMonthRange(new Date(), startDay);

  const budgetLeft = Math.max(0, data.totalBudgeted - data.totalBudgetSpent);
  const overallBudgetPct =
    data.totalBudgeted > 0
      ? Math.round((data.totalBudgetSpent / data.totalBudgeted) * 100)
      : 0;
  const overallRingColor =
    overallBudgetPct >= 100
      ? "var(--color-destructive)"
      : overallBudgetPct >= 80
        ? "var(--color-warning)"
        : "var(--color-primary)";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Top: ring + summary */}
        <div className="flex items-center gap-5 p-6 pb-4">
          <div className="relative">
            <RingProgress
              percentage={overallBudgetPct}
              size={72}
              strokeWidth={8}
              color={overallRingColor}
              trackColor="hsl(var(--muted))"
              ariaLabel={`Budget: ${overallBudgetPct} percent used`}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-bold leading-none tabular-nums">
                {overallBudgetPct}%
              </span>
              <span className="text-xs text-muted-foreground">used</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-muted-foreground">
                {monthLabel} Budget
              </p>
              <Link
                href="/budgets"
                className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded flex items-center gap-0.5"
              >
                All Budgets{" "}
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
            <p className="text-3xl font-bold tracking-tight tabular-nums">
              {formatCurrency(budgetLeft)}{" "}
              <span className="text-base font-normal text-muted-foreground">
                left to spend
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCurrency(data.totalBudgetSpent)} spent of{" "}
              {formatCurrency(data.totalBudgeted)} {periodCopy}
            </p>
          </div>
        </div>

        {/* Dual progress bars */}
        <div className="px-6 pb-4 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-14 shrink-0">
              Spent
            </span>
            <div
              className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={overallBudgetPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Budget: ${overallBudgetPct}% spent`}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(overallBudgetPct, 100)}%`,
                  backgroundColor: overallRingColor,
                }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums w-10 text-right">
              {overallBudgetPct}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-14 shrink-0">
              Month
            </span>
            <div
              className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(data.monthProgress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Month: ${Math.round(data.monthProgress * 100)}% elapsed`}
            >
              <div
                className="h-full rounded-full bg-muted-foreground/30 transition-all duration-500"
                style={{
                  width: `${Math.round(data.monthProgress * 100)}%`,
                }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums w-10 text-right">
              {Math.round(data.monthProgress * 100)}%
            </span>
          </div>
        </div>

        {/* Category chips */}
        {data.budgetItems.length > 0 && (
        <div className="relative border-t">
          <div className="px-6 py-4 flex gap-3 overflow-x-auto scrollbar-hide">
            {data.budgetItems.map((item, i) => {
              const pct = Math.min(item.percentage, 100);
              const ringColor =
                item.status === "exceeded"
                  ? "var(--color-destructive)"
                  : item.status === "warning"
                    ? "var(--color-warning)"
                    : item.categoryColor || "var(--color-primary)";
              const left = Math.max(0, item.limit - item.spent);

              const chipContent = (
                <>
                  <div className="relative">
                    <RingProgress
                      percentage={pct}
                      size={40}
                      strokeWidth={4}
                      color={ringColor}
                      trackColor="hsl(var(--muted))"
                      ariaLabel={`${item.categoryName}: ${pct} percent of budget used`}
                    />
                    <span
                      className="absolute inset-0 flex items-center justify-center"
                      aria-hidden="true"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: item.categoryColor || "#94a3b8",
                        }}
                      />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      {item.categoryName}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(item.spent)} /{" "}
                      {formatCurrency(item.limit)}
                    </p>
                    <p
                      className={`text-xs font-semibold ${
                        item.status === "exceeded"
                          ? "text-red-500 dark:text-red-400"
                          : item.status === "warning"
                            ? "text-amber-500 dark:text-amber-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {item.status === "exceeded"
                        ? `${formatCurrency(item.spent - item.limit)} over`
                        : `${formatCurrency(left)} left`}
                    </p>
                  </div>
                </>
              );

              const chipClass =
                "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 shrink-0 min-w-[170px]";

              return item.categoryId ? (
                <TransactionsFilterLink
                  key={item.categoryId}
                  category={item.categoryId}
                  period={fmRange ? undefined : "this-month"}
                  dateFrom={fmRange?.from}
                  dateTo={fmRange?.to}
                  className={`${chipClass} transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                >
                  {chipContent}
                </TransactionsFilterLink>
              ) : (
                <div key={i} className={chipClass}>
                  {chipContent}
                </div>
              );
            })}
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-card to-transparent pointer-events-none" />
        </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BudgetOverviewSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center gap-5 p-6 pb-4">
          <Skeleton className="h-[72px] w-[72px] rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="px-6 pb-4 space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
        <div className="border-t px-6 py-4 flex gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className="h-16 w-[170px] rounded-xl shrink-0"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
