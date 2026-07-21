import { ArrowRight } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionsFilterLink } from "@/components/transactions-filter-link";
import { getTopCategories } from "../_lib/dashboard-queries";
import { formatCurrency } from "@/lib/utils";
import {
  formatFinancialMonthLabel,
  getFinancialMonthRange,
} from "@/lib/financial-month";

export async function TopSpendingCard({
  userId,
  startDay = 1,
  accountId,
}: {
  userId: string;
  startDay?: number;
  accountId?: string;
}) {
  const topCategories = await getTopCategories(userId, startDay, accountId);

  const monthLabel = formatFinancialMonthLabel(new Date(), startDay);
  const periodCopy = startDay === 1 ? "this month" : "this period";
  const fmRange = startDay === 1 ? null : getFinancialMonthRange(new Date(), startDay);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Top Spending</CardTitle>
          <Link
            href="/insights"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            Insights <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {topCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No expenses {periodCopy} yet.
          </p>
        ) : (
          <div className="space-y-1">
            {(() => {
              const max = topCategories[0]?.total || 1;
              return topCategories.map((cat) => {
                const rowContent = (
                  <>
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-sm w-28 truncate">{cat.name}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(cat.total / max) * 100}%`,
                          backgroundColor: cat.color,
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold w-24 text-right tabular-nums">
                      {formatCurrency(cat.total)}
                    </span>
                  </>
                );
                const rowClass =
                  "flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-md";
                return cat.categoryId ? (
                  <TransactionsFilterLink
                    key={cat.categoryId}
                    category={cat.categoryId}
                    period={fmRange ? undefined : "this-month"}
                    dateFrom={fmRange?.from}
                    dateTo={fmRange?.to}
                    className={`${rowClass} transition-colors hover:bg-muted/50`}
                  >
                    {rowContent}
                  </TransactionsFilterLink>
                ) : (
                  <div key={cat.name} className={rowClass}>
                    {rowContent}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TopSpendingCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-32 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-3 rounded-full shrink-0" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 flex-1 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
