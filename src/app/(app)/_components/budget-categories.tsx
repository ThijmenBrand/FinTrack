import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getBudgetOverview, getUserPlans } from "../_lib/dashboard-queries";
import { BudgetCategoriesCard } from "./budget-categories-card";

/**
 * Server shell for the dashboard budget card: fetches the plan's overview and
 * the plan list, then hands rendering (and in-card budget switching) to the
 * client card. `planId` is the page's ?budget= pin; without it the card opens
 * on the main plan as before.
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
  const [data, plans] = await Promise.all([
    getBudgetOverview(userId, startDay, planId),
    getUserPlans(userId),
  ]);

  return (
    <BudgetCategoriesCard initialData={data} plans={plans} startDay={startDay} />
  );
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
