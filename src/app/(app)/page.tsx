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

/** Period line above the cards — the only place the dates are spelled out. */
function DashboardHeader({ startDay }: { startDay: number }) {
  const now = new Date();
  const { daysLeft, progress } = getPeriodProgress(now, startDay);

  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {formatFinancialMonthLabel(now, startDay)} · {daysLeft} day
          {daysLeft === 1 ? "" : "s"} left · {Math.round(progress * 100)}% through
          the period
        </p>
      </div>
      <Link
        href="/budgets"
        className="flex shrink-0 items-center gap-0.5 rounded text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        All budgets <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const userId = session.userId;
  const prefs = await getUserPreferences(userId);
  const startDay = prefs.financialMonthStartDay;
  const accountId = prefs.defaultAccountId ?? undefined;

  return (
    <div className="space-y-4">
      <DashboardHeader startDay={startDay} />

      <Suspense fallback={<PeriodSummarySkeleton />}>
        <PeriodSummary userId={userId} startDay={startDay} accountId={accountId} />
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
          <Suspense fallback={<ComingUpThisMonthCardSkeleton />}>
            <ComingUpThisMonthCard
              userId={userId}
              startDay={startDay}
              accountId={accountId}
            />
          </Suspense>
          <Suspense fallback={<TopSpendingCardSkeleton />}>
            <TopSpendingCard
              userId={userId}
              startDay={startDay}
              accountId={accountId}
            />
          </Suspense>
          <Suspense fallback={<SavingTowardCardSkeleton />}>
            <SavingTowardCard userId={userId} startDay={startDay} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
