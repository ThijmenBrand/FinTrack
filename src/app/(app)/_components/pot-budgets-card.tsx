import { Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPotBudgets } from "../_lib/dashboard-queries";
import { PotBudgetsList } from "./pot-budgets-list";
import { getI18n } from "@/lib/i18n/server";

/**
 * Pots being spent against their budget — an undated budget, or a trip whose
 * date has come. Nothing to show, no card: Saving toward covers the run-up.
 */
export async function PotBudgetsCard({ userId }: { userId: string }) {
  const [pots, { t, plural }] = await Promise.all([getPotBudgets(userId), getI18n()]);
  if (pots.length === 0) return null;
  const over = pots.filter((p) => p.status === "exceeded").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          {t("dashboard.potBudgets.title")}
        </CardTitle>
        <CardDescription>
          {over > 0
            ? plural(over, "dashboard.potBudgets.over.one", "dashboard.potBudgets.over.other")
            : plural(pots.length, "dashboard.potBudgets.count.one", "dashboard.potBudgets.count.other")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PotBudgetsList pots={pots} />
      </CardContent>
    </Card>
  );
}

export function PotBudgetsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-1 h-4 w-48" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
