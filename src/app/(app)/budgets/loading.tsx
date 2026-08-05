import { BudgetsSkeleton } from "./_components/budgets-skeleton";

// Without this, navigating here falls back to (app)/loading.tsx and flashes
// the dashboard's skeletons before the budgets page even mounts.
export default function BudgetsLoading() {
  return <BudgetsSkeleton />;
}
