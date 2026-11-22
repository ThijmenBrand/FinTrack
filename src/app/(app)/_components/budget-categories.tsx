import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getBudgetOverview } from "../_lib/dashboard-queries";
import { BudgetCategoriesCard } from "./budget-categories-card";

/**
 * Server shell for the dashboard budget card: fetches the scoped plan's
 * overview and hands rendering to the client card. `planId` is the budget the
 * page resolved — the ?budget= link, else the app-wide scope; without it the
 * card falls back to the main plan.
 */
export async function BudgetCategories({
  userId,
  startDay = 1,
  planId,
}: {
  userId: string;
  startDay?: number;
  planId?: string;
}) {
  const data = await getBudgetOverview(userId, startDay, planId);

  return <BudgetCategoriesCard initialData={data} startDay={startDay} />;
}

export function BudgetCategoriesSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-64 mt-1" />
      </CardHeader>
      <CardContent className="px-6 pb-4 space-y-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-32 shrink-0" />
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
