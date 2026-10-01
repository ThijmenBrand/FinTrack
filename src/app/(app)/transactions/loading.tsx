import { TransactionsPageSkeleton } from "./_components/transactions-skeleton";

// Without this, navigating here falls back to (app)/loading.tsx and flashes
// the dashboard's skeletons before the transactions page even mounts.
export default function TransactionsLoading() {
  return <TransactionsPageSkeleton />;
}
