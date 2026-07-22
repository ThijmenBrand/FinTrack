export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
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

export default async function DashboardPage() {
  const session = await requireAuth();
  const userId = session.userId;
  const prefs = await getUserPreferences(userId);
  const startDay = prefs.financialMonthStartDay;
  const accountId = prefs.defaultAccountId ?? undefined;

  return (
    <div className="space-y-6">
      <Suspense fallback={<PeriodSummarySkeleton />}>
        <PeriodSummary userId={userId} startDay={startDay} accountId={accountId} />
      </Suspense>

      <Suspense fallback={<BudgetCategoriesSkeleton />}>
        <BudgetCategories userId={userId} startDay={startDay} />
      </Suspense>

      <Suspense fallback={<ComingUpThisMonthCardSkeleton />}>
        <ComingUpThisMonthCard userId={userId} startDay={startDay} accountId={accountId} />
      </Suspense>

      <Suspense fallback={<SavingTowardCardSkeleton />}>
        <SavingTowardCard userId={userId} startDay={startDay} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<TopSpendingCardSkeleton />}>
          <TopSpendingCard userId={userId} startDay={startDay} accountId={accountId} />
        </Suspense>
        <Suspense fallback={<AccountsCardSkeleton />}>
          <AccountsCard userId={userId} />
        </Suspense>
      </div>
    </div>
  );
}
