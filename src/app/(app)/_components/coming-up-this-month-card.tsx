import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock } from "lucide-react";
import { getMonthMoneyView } from "../_lib/dashboard-queries";
import { ComingUpThisMonthList } from "./coming-up-this-month-list";
import { getI18n } from "@/lib/i18n/server";

export async function ComingUpThisMonthCard({
  userId,
  startDay = 1,
  accountIds,
}: {
  userId: string;
  startDay?: number;
  accountIds?: string[];
}) {
  const [money, { t, plural }] = await Promise.all([
    getMonthMoneyView(userId, startDay, accountIds),
    getI18n(),
  ]);

  if (money.thisMonthSpikes.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          {startDay === 1
            ? t("dashboard.comingUp.titleMonth")
            : t("dashboard.comingUp.titlePeriod")}
        </CardTitle>
        <CardDescription>
          {startDay === 1
            ? plural(
                money.thisMonthSpikes.length,
                "dashboard.comingUp.countMonth.one",
                "dashboard.comingUp.countMonth.other",
              )
            : plural(
                money.thisMonthSpikes.length,
                "dashboard.comingUp.countPeriod.one",
                "dashboard.comingUp.countPeriod.other",
              )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ComingUpThisMonthList
          spikes={money.thisMonthSpikes}
          freeToSpend={money.freeToSpend}
          freeToSpendAfterSpikes={money.freeToSpendAfterSpikes}
          hasIncome={money.hasIncome}
        />
      </CardContent>
    </Card>
  );
}

export function ComingUpThisMonthCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-56 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-7 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
