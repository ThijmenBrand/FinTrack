import Link from "next/link";
import { PiggyBank } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSavingTowardSpikes } from "../_lib/dashboard-queries";
import { SavingTowardList } from "./saving-toward-list";
import { getI18n } from "@/lib/i18n/server";

export async function SavingTowardCard({
  userId,
  startDay = 1,
}: {
  userId: string;
  startDay?: number;
}) {
  const [spikes, { t, plural }] = await Promise.all([
    getSavingTowardSpikes(userId, startDay),
    getI18n(),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-primary" />
          {t("dashboard.savingToward.title")}
        </CardTitle>
        <CardDescription>
          {spikes.length === 0
            ? t("dashboard.savingToward.empty")
            : plural(
                spikes.length,
                "dashboard.savingToward.goals.one",
                "dashboard.savingToward.goals.other",
              )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {spikes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <PiggyBank className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground max-w-xs">
              {t("dashboard.savingToward.emptyBody")}{" "}
              <Link href="/pots" className="text-primary hover:underline">
                {t("dashboard.savingToward.goToPots")}
              </Link>
              .
            </p>
          </div>
        ) : (
          <SavingTowardList spikes={spikes} />
        )}
      </CardContent>
    </Card>
  );
}

export function SavingTowardCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
