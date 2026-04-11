import { HeroWeeklySpendingSkeleton } from "./_components/hero-weekly-spending";
import { BudgetOverviewSkeleton } from "./_components/budget-overview";
import { MonthSummaryGridSkeleton } from "./_components/month-summary-grid";
import { TopSpendingCardSkeleton } from "./_components/top-spending-card";
import { AccountsCardSkeleton } from "./_components/accounts-card";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <HeroWeeklySpendingSkeleton />
      <BudgetOverviewSkeleton />
      <MonthSummaryGridSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopSpendingCardSkeleton />
        <AccountsCardSkeleton />
      </div>
    </div>
  );
}
