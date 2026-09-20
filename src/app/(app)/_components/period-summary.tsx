import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getBudgetOverview, getMonthSummary } from "../_lib/dashboard-queries";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { getI18n } from "@/lib/i18n/server";
import type { I18n } from "@/lib/i18n/translate";

/**
 * Spent-against-budget on a single linear scale. When you overspend the bar
 * keeps growing past the limit instead of pinning at 100% like the old gauge
 * did, so the tick marks where the budget ran out and the red tail shows by
 * how much.
 */
function BudgetBar({ spent, budgeted, t }: { spent: number; budgeted: number; t: I18n["t"] }) {
  const over = spent > budgeted;
  const scale = Math.max(spent, budgeted);
  const limitPct = (budgeted / scale) * 100;
  const spentPct = (spent / scale) * 100;

  return (
    <div className="mt-3">
      <div
        className="relative h-2 rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(budgeted)}
        aria-valuenow={Math.round(spent)}
        aria-label={t("dashboard.spentOfTotal")}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <div
            className={`h-full transition-all duration-500 ${
              over || spent / budgeted >= 0.8 ? "bg-amber-500" : "bg-emerald-500"
            }`}
            style={{ width: `${over ? limitPct : spentPct}%` }}
          />
          {over && (
            <div
              className="absolute inset-y-0 bg-red-500"
              style={{ left: `${limitPct}%`, width: `${spentPct - limitPct}%` }}
            />
          )}
        </div>
        {over && (
          <div
            className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-foreground"
            style={{ left: `${limitPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {over && (
        // Nudged left so the label reads as centred under the tick.
        <div
          className="mt-1 text-[11px] text-muted-foreground"
          style={{ marginLeft: `max(0px, calc(${limitPct}% - 30px))` }}
        >
          {t("dashboard.budgetLimit")}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  href,
}: {
  label: string;
  value: string;
  valueClass?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums sm:text-lg ${valueClass ?? ""}`}>
        {value}
      </p>
    </>
  );
  if (!href) return <div className="min-w-0 flex-1 lg:flex-none">{body}</div>;
  return (
    <Link
      href={href}
      className="min-w-0 flex-1 rounded hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring lg:flex-none"
    >
      {body}
    </Link>
  );
}

export async function PeriodSummary({
  userId,
  startDay = 1,
  accountIds,
  planId,
}: {
  userId: string;
  startDay?: number;
  accountIds?: string[];
  /** The page's ?budget= pin; without it the headline follows the main plan. */
  planId?: string;
}) {
  const [budget, summary, { t, formatCurrency }] = await Promise.all([
    getBudgetOverview(userId, startDay, planId),
    getMonthSummary(userId, startDay, accountIds),
    getI18n(),
  ]);

  const period = getFinancialMonthRange(new Date(), startDay);
  const hasBudget = budget.totalBudgeted > 0;
  const left = budget.totalBudgeted - budget.totalBudgetSpent;
  const pct = hasBudget
    ? Math.round((budget.totalBudgetSpent / budget.totalBudgeted) * 100)
    : 0;
  const over = hasBudget && left < 0;
  const net = summary.monthIncome - summary.monthExpenses;

  // Link the Earned/Spent tiles to the same financial period on /transactions.
  const txHref = (type: "income" | "expense") => {
    const p = new URLSearchParams({
      type,
      dateFrom: period.from,
      dateTo: period.to,
    });
    if (accountIds?.length) p.set("account", accountIds.join(","));
    return `/transactions?${p}`;
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-4 sm:p-6 lg:flex-row lg:items-center lg:gap-10">
        <div className="min-w-0 lg:flex-1">
          {hasBudget ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={`text-xl font-semibold tabular-nums sm:text-2xl ${
                    over
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {formatCurrency(Math.abs(left))}{" "}
                  {over ? t("dashboard.overBudget") : t("dashboard.leftToSpend")}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("dashboard.spentOfWithPct", {
                    spent: formatCurrency(budget.totalBudgetSpent),
                    total: formatCurrency(budget.totalBudgeted),
                    pct,
                  })}
                  {budget.plan && (
                    <> · {t("dashboard.planBudgetSuffix", { name: budget.plan.name })}</>
                  )}
                </span>
              </div>
              <BudgetBar
                spent={budget.totalBudgetSpent}
                budgeted={budget.totalBudgeted}
                t={t}
              />
              {/* The bar only measures spending that has a budget behind it.
                  Without this line the rest of the month's money would simply
                  be missing from the headline — say how much it was and where
                  it went. The card below lists every one of them with amounts. */}
              {budget.unbudgetedTotal > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("dashboard.outsideBudget", {
                    amount: formatCurrency(budget.unbudgetedTotal),
                  })}{" "}
                  <span className="text-foreground/80">
                    {budget.unbudgetedItems
                      .slice(0, 3)
                      .map((i) => i.categoryName || t("common.uncategorized"))
                      .join(", ")}
                    {budget.unbudgetedItems.length > 3 &&
                      ` · ${t("dashboard.outsideBudgetMore", {
                        count: budget.unbudgetedItems.length - 3,
                      })}`}
                  </span>
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums sm:text-2xl">
                {formatCurrency(summary.monthExpenses)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("dashboard.spentThisPeriod")}{" "}
                <Link href="/budgets" className="text-primary hover:underline">
                  {t("dashboard.setBudgets")}
                </Link>{" "}
                {t("dashboard.toSeeWhatsLeft")}
              </p>
            </>
          )}
        </div>

        {/* Amounts are unbreakable, so the tiles shrink with the viewport
            instead of spilling out of their track. */}
        <div className="flex gap-4 border-t pt-4 sm:gap-8 lg:shrink-0 lg:border-0 lg:pt-0">
          <Stat
            label={t("dashboard.earned")}
            value={formatCurrency(summary.monthIncome)}
            valueClass="text-emerald-600 dark:text-emerald-400"
            href={txHref("income")}
          />
          <Stat
            label={t("dashboard.spent")}
            value={formatCurrency(summary.monthExpenses)}
            href={txHref("expense")}
          />
          <Stat
            label={t("dashboard.net")}
            value={formatCurrency(net)}
            valueClass={
              net >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function PeriodSummarySkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-4 sm:p-6 lg:flex-row lg:items-center lg:gap-10">
        <div className="lg:flex-1">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
        </div>
        <div className="flex gap-4 border-t pt-4 sm:gap-8 lg:shrink-0 lg:border-0 lg:pt-0">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-1 lg:flex-none">
              <Skeleton className="mb-1.5 h-3 w-12" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
