"use client";

import Link from "next/link";
import { ArrowRight, PiggyBank } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TransactionsFilterLink } from "@/components/transactions-filter-link";
import { CategoryIcon } from "@/components/category-icon";
import { getFinancialMonthRange } from "@/lib/financial-month";
import type { BudgetOverview } from "../_lib/dashboard-queries";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const PERIOD_LABEL_KEYS: Record<string, MessageKey> = {
  weekly: "budgets.period.weekly",
  monthly: "budgets.period.monthly",
  yearly: "budgets.period.yearly",
};

// Mobile is a native list row: the category's icon, then two lines beside it —
// name · what's left, then bar · spent/budget. The trailing columns are fixed
// widths on desktop so the bars line up instead of being sized by however long
// each amount happens to be.
const ROW =
  "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,13.5rem)_minmax(96px,1fr)_7rem_8.5rem] sm:rounded-lg sm:py-2.5";

interface BudgetCategoriesCardProps {
  initialData: BudgetOverview;
  startDay: number;
}

/**
 * The dashboard budget card. Which budget it shows is the app-wide scope the
 * sidebar selector sets, resolved on the server — the card used to carry its
 * own switcher, which could leave it disagreeing with the rest of the page.
 * Its subtitle still names the plan, so "All budgets" doesn't hide which one
 * these categories belong to.
 */
export function BudgetCategoriesCard({
  initialData,
  startDay,
}: BudgetCategoriesCardProps) {
  const { t, formatCurrency } = useI18n();
  const data = initialData;
  const selectedPlan = data.plan;

  const fmRange =
    startDay === 1 ? null : getFinancialMonthRange(new Date(), startDay);
  // Rows link into /transactions scoped to the same accounts the card counted,
  // so the list behind a category always matches the bar you clicked. No plan
  // (or a plan with no accounts) links unscoped, as before.
  const planAccountIds = data?.plan?.accountIds ?? [];
  const filterProps = {
    account: planAccountIds.length ? planAccountIds.join(",") : undefined,
    period: fmRange ? undefined : ("this-month" as const),
    dateFrom: fmRange?.from,
    dateTo: fmRange?.to,
  };


  const planLabel = selectedPlan
    ? [
        t(
          selectedPlan.isMain
            ? "dashboard.budgetCard.planMain"
            : "dashboard.budgetCard.planOther",
          { name: selectedPlan.name },
        ),
        selectedPlan.ownerName ? t("sharing.sharedBy", { name: selectedPlan.ownerName }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>{t("dashboard.budgetCard.title")}</CardTitle>
            <Link
              href="/budgets"
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              {t("dashboard.budgetCard.manage")}{" "}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-4">
          <div className="space-y-4 py-2" aria-busy="true">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const pacePct = Math.round(data.monthProgress * 100);

  if (data.budgetItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("dashboard.budgetCard.emptyTitle")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <PiggyBank className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground max-w-sm">
              {selectedPlan
                ? t("dashboard.budgetCard.emptyPlan", { name: selectedPlan.name })
                : t("dashboard.budgetCard.emptyGeneric")}
            </p>
            <Link
              href="/budgets"
              className="mt-3 text-sm text-primary hover:underline"
            >
              {t("dashboard.budgetCard.setUp")}
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
          <CardTitle>{t("dashboard.budgetCard.title")}</CardTitle>
          <Link
            href="/budgets"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            {t("dashboard.budgetCard.manage")}{" "}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <CardDescription>
          {planLabel && <>{planLabel} &middot; </>}
          <span className="max-sm:hidden">
            {t("dashboard.budgetCard.paceHint", { pct: pacePct })}
          </span>
          <span className="sm:hidden">
            {t("dashboard.budgetCard.paceHintShort", { pct: pacePct })}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-1 sm:px-2 sm:pb-3">
        <ul className="max-sm:divide-y max-sm:divide-border/60">
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
                <CategoryIcon
                  icon={item.categoryIcon}
                  color={item.categoryColor}
                  className="col-start-1 row-span-2 row-start-1 sm:hidden"
                />
                <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-2 sm:col-start-1">
                  <span className="truncate text-sm font-medium">
                    {item.categoryName || t("common.uncategorized")}
                  </span>
                  {/* Non-monthly budgets run on their own clock, so the
                      period tick below doesn't apply to them — say so. */}
                  {item.period !== "monthly" && (
                    <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-semibold text-muted-foreground">
                      {PERIOD_LABEL_KEYS[item.period]
                        ? t(PERIOD_LABEL_KEYS[item.period])
                        : item.period}
                    </span>
                  )}
                </div>
                <div className="col-start-2 row-start-2 sm:row-start-1">
                  <div
                    className="relative h-2 rounded-full bg-muted sm:h-1.5"
                    role="progressbar"
                    aria-valuenow={Math.min(item.percentage, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("dashboard.budgetCard.progressLabel", {
                      name: item.categoryName ?? t("common.category"),
                      pct: item.percentage,
                    })}
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
                  className={`col-start-3 row-start-1 text-right text-sm font-semibold tabular-nums ${
                    over
                      ? "text-red-600 dark:text-red-400"
                      : item.status === "warning"
                        ? "text-amber-600 dark:text-amber-400"
                        : ""
                  }`}
                >
                  {over
                    ? t("dashboard.budgetCard.overAmount", { amount: formatCurrency(-left) })
                    : t("dashboard.budgetCard.leftAmount", { amount: formatCurrency(left) })}
                </span>
                <span className="col-start-3 row-start-2 text-right text-xs text-muted-foreground tabular-nums sm:col-start-4 sm:row-start-1">
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
                    className={`${ROW} transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60`}
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
          <div className="mt-1 border-t pt-3 pb-3 sm:mt-3 sm:pb-0">
            <div className="flex items-baseline justify-between gap-2 px-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("dashboard.budgetCard.notBudgeted")}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(data.unbudgetedTotal)}
              </span>
            </div>
            <p className="px-4 pb-1 text-xs text-muted-foreground">
              {t("dashboard.budgetCard.notBudgetedHint")}
            </p>
            {/* Two columns: these are bare name/amount pairs, so a single
                column would leave half the card empty on desktop. */}
            <ul className="grid px-4 sm:grid-cols-2 sm:gap-x-6">
              {data.unbudgetedItems.map((item, i) => {
                const row = (
                  <>
                    <span className="truncate text-sm">
                      {item.categoryName || t("common.uncategorized")}
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
              {t("dashboard.budgetCard.setBudgetsForThese")}{" "}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
