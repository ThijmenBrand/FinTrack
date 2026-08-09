"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, PiggyBank, Star } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransactionsFilterLink } from "@/components/transactions-filter-link";
import { apiFetch } from "@/lib/api";
import { getFinancialMonthRange } from "@/lib/financial-month";
import type { BudgetOverview } from "../_lib/dashboard-queries";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const PERIOD_LABEL_KEYS: Record<string, MessageKey> = {
  weekly: "budgets.period.weekly",
  monthly: "budgets.period.monthly",
  yearly: "budgets.period.yearly",
};

// Mobile stacks each row onto two lines — name · delta, then bar · spent/budget.
// The trailing columns are fixed widths on desktop so the bars line up instead
// of being sized by however long each amount happens to be.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-4 py-2.5 sm:grid-cols-[minmax(0,13.5rem)_minmax(96px,1fr)_7rem_8.5rem]";

interface PlanOption {
  id: string;
  name: string;
  isMain: boolean;
}

interface BudgetCategoriesCardProps {
  initialData: BudgetOverview;
  plans: PlanOption[];
  startDay: number;
}

/**
 * The dashboard budget card. Server-rendered with the main plan's data; the
 * in-card switcher peeks at another budget without re-scoping the rest of the
 * dashboard.
 */
export function BudgetCategoriesCard({
  initialData,
  plans,
  startDay,
}: BudgetCategoriesCardProps) {
  const { t, formatCurrency } = useI18n();
  const initialPlanId = initialData.plan?.id ?? null;
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(initialPlanId);
  const viewingOther = selectedPlanId !== null && selectedPlanId !== initialPlanId;

  const { data: switchedData, isLoading: switching } = useQuery({
    queryKey: ["dashboard-budget-overview", selectedPlanId],
    queryFn: () =>
      apiFetch<BudgetOverview>(
        `/api/dashboard/budget-overview?budgetId=${encodeURIComponent(selectedPlanId ?? "")}`,
      ),
    enabled: viewingOther,
  });

  const data = viewingOther ? switchedData : initialData;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  const fmRange =
    startDay === 1 ? null : getFinancialMonthRange(new Date(), startDay);
  const filterProps = {
    period: fmRange ? undefined : ("this-month" as const),
    dateFrom: fmRange?.from,
    dateTo: fmRange?.to,
  };

  const switcher = plans.length > 1 && (
    <Select
      value={selectedPlanId ?? undefined}
      onValueChange={setSelectedPlanId}
    >
      <SelectTrigger
        className="h-7 w-auto gap-1.5 border-none bg-transparent px-2 text-sm font-medium shadow-none hover:bg-muted/60"
        aria-label={t("dashboard.budgetCard.switcherLabel")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {plans.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-1.5">
              {p.name}
              {p.isMain && (
                <Star
                  className="h-3 w-3 fill-current text-amber-500"
                  aria-label={t("dashboard.budgetCard.mainBudgetStar")}
                />
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const planLabel = selectedPlan
    ? t(
        selectedPlan.isMain
          ? "dashboard.budgetCard.planMain"
          : "dashboard.budgetCard.planOther",
        { name: selectedPlan.name },
      )
    : null;

  if (!data || (viewingOther && switching)) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>{t("dashboard.budgetCard.title")}</CardTitle>
              {switcher}
            </div>
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
            <div className="flex items-center gap-2">
              <CardTitle>{t("dashboard.budgetCard.emptyTitle")}</CardTitle>
              {switcher}
            </div>
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
          <div className="flex items-center gap-2">
            <CardTitle>{t("dashboard.budgetCard.title")}</CardTitle>
            {switcher}
          </div>
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
          {t("dashboard.budgetCard.paceHint", { pct: pacePct })}
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
                <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1">
                  <div
                    className="relative h-1.5 rounded-full bg-muted"
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
                  className={`col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums sm:col-start-3 ${
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
