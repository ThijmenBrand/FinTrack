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

export async function ComingUpThisMonthCard({
  userId,
  startDay = 1,
}: {
  userId: string;
  startDay?: number;
}) {
  const money = await getMonthMoneyView(userId, startDay);

  if (money.thisMonthSpikes.length === 0) return null;

  const periodCopy = startDay === 1 ? "the month" : "this period";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          {startDay === 1 ? "Coming up this month" : "Coming up this period"}
        </CardTitle>
        <CardDescription>
          {money.thisMonthSpikes.length} planned event
          {money.thisMonthSpikes.length === 1 ? "" : "s"} between now and the end of {periodCopy}
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
