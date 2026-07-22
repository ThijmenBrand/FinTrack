import { PeriodSummarySkeleton } from "./_components/period-summary";
import { BudgetCategoriesSkeleton } from "./_components/budget-categories";
import { TopSpendingCardSkeleton } from "./_components/top-spending-card";
import { AccountsCardSkeleton } from "./_components/accounts-card";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <PeriodSummarySkeleton />
      <BudgetCategoriesSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopSpendingCardSkeleton />
        <AccountsCardSkeleton />
      </div>
    </div>
  );
}
