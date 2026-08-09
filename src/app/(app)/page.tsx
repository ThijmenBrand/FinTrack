export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import {
  formatFinancialMonthLabel,
  getPeriodProgress,
} from "@/lib/financial-month";
import {
  PeriodSummary,
  PeriodSummarySkeleton,
} from "./_components/period-summary";
import { getMainPlan, getScopeAccountRows } from "./_lib/dashboard-queries";
import { defaultScopeAccountIds } from "@/lib/account-scope";
import {
  BudgetCategories,
  BudgetCategoriesSkeleton,
} from "./_components/budget-categories";
import {
  TopSpendingCard,
  TopSpendingCardSkeleton,
} from "./_components/top-spending-card";
import {
  AccountsCard,
  AccountsCardSkeleton,
} from "./_components/accounts-card";
import {
  ComingUpThisMonthCard,
  ComingUpThisMonthCardSkeleton,
} from "./_components/coming-up-this-month-card";
import {
  SavingTowardCard,
  SavingTowardCardSkeleton,
} from "./_components/saving-toward-card";
import { getI18n } from "@/lib/i18n/server";
import type { I18n } from "@/lib/i18n/translate";

/** Period line above the cards — the only place the dates are spelled out. */
function DashboardHeader({ startDay, i18n }: { startDay: number; i18n: I18n }) {
  const { t, plural, intlLocale } = i18n;
  const now = new Date();
  const { daysLeft, progress } = getPeriodProgress(now, startDay);

  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {plural(daysLeft, "dashboard.periodLine.one", "dashboard.periodLine.other", {
            label: formatFinancialMonthLabel(now, startDay, intlLocale),
            pct: Math.round(progress * 100),
          })}
        </p>
      </div>
      <Link
        href="/budgets"
        className="flex shrink-0 items-center gap-0.5 rounded text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("dashboard.allBudgets")}{" "}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const userId = session.userId;
  // The account query doesn't depend on prefs, so don't wait on them serially —
  // against a remote DB each round trip here delays every card below.
  const [prefs, scopeRows, mainPlan, i18n] = await Promise.all([
    getUserPreferences(userId),
    getScopeAccountRows(userId),
    getMainPlan(userId),
    getI18n(),
  ]);
  const startDay = prefs.financialMonthStartDay;
  // Everyday money only: all checking accounts (see defaultScopeAccountIds).
  // Drives the Earned/Spent/Net tiles.
  const accountIds = defaultScopeAccountIds(scopeRows, prefs.defaultAccountId);
  // Free-to-spend math follows the main budget's accounts; without plans it
  // falls back to the same all-checking scope.
  const mainPlanAccountIds = mainPlan ? mainPlan.accountIds : accountIds;

  return (
    <div className="space-y-4">
      <DashboardHeader startDay={startDay} i18n={i18n} />

      <Suspense fallback={<PeriodSummarySkeleton />}>
        <PeriodSummary userId={userId} startDay={startDay} accountIds={accountIds} />
      </Suspense>

      {/* Budgets carry the page, so they get the wide column; the side cards
          are all glanceable and keep their fixed width. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Suspense fallback={<BudgetCategoriesSkeleton />}>
          <BudgetCategories userId={userId} startDay={startDay} />
        </Suspense>

        <div className="space-y-4">
          <Suspense fallback={<AccountsCardSkeleton />}>
            <AccountsCard userId={userId} />
          </Suspense>
          {/* Simple mode: balances and budgets only — the extra glanceable
              cards are exactly the clutter it exists to remove. */}
          {!prefs.simpleMode && (
            <>
              <Suspense fallback={<ComingUpThisMonthCardSkeleton />}>
                <ComingUpThisMonthCard
                  userId={userId}
                  startDay={startDay}
                  accountIds={mainPlanAccountIds}
                />
              </Suspense>
              <Suspense fallback={<TopSpendingCardSkeleton />}>
                <TopSpendingCard userId={userId} startDay={startDay} />
              </Suspense>
              <Suspense fallback={<SavingTowardCardSkeleton />}>
                <SavingTowardCard userId={userId} startDay={startDay} />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
