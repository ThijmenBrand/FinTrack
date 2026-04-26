export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import {
  HeroWeeklySpending,
  HeroWeeklySpendingSkeleton,
} from "./_components/hero-weekly-spending";
import {
  BudgetOverview,
  BudgetOverviewSkeleton,
} from "./_components/budget-overview";
import {
  MonthSummaryGrid,
  MonthSummaryGridSkeleton,
} from "./_components/month-summary-grid";
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

export default async function DashboardPage() {
  const session = await requireAuth();
  const userId = session.userId;

  return (
    <div className="space-y-6">
      <Suspense fallback={<HeroWeeklySpendingSkeleton />}>
        <HeroWeeklySpending userId={userId} />
      </Suspense>

      <Suspense fallback={<MonthSummaryGridSkeleton />}>
        <MonthSummaryGrid userId={userId} />
      </Suspense>

      <Suspense fallback={<ComingUpThisMonthCardSkeleton />}>
        <ComingUpThisMonthCard userId={userId} />
      </Suspense>

      <Suspense fallback={<BudgetOverviewSkeleton />}>
        <BudgetOverview userId={userId} />
      </Suspense>

      <Suspense fallback={<SavingTowardCardSkeleton />}>
        <SavingTowardCard userId={userId} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<TopSpendingCardSkeleton />}>
          <TopSpendingCard userId={userId} />
        </Suspense>
        <Suspense fallback={<AccountsCardSkeleton />}>
          <AccountsCard userId={userId} />
        </Suspense>
      </div>
    </div>
  );
}
