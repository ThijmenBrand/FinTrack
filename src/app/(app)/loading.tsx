import { Skeleton } from "@/components/ui/skeleton";
import { PeriodSummarySkeleton } from "./_components/period-summary";
import { BudgetCategoriesSkeleton } from "./_components/budget-categories";
import { TopSpendingCardSkeleton } from "./_components/top-spending-card";
import { AccountsCardSkeleton } from "./_components/accounts-card";

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1.5 h-4 w-72" />
      </div>
      <PeriodSummarySkeleton />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <BudgetCategoriesSkeleton />
        <div className="space-y-4">
          <AccountsCardSkeleton />
          <TopSpendingCardSkeleton />
        </div>
      </div>
    </div>
  );
}
