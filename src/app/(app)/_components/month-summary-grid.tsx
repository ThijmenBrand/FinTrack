import {
  Landmark,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getMonthSummary } from "../_lib/dashboard-queries";
import { formatFinancialMonthLabel } from "@/lib/financial-month";
import { formatCurrency } from "@/lib/utils";

export async function MonthSummaryGrid({
  userId,
  startDay = 1,
  accountId,
}: {
  userId: string;
  startDay?: number;
  accountId?: string;
}) {
  const data = await getMonthSummary(userId, startDay, accountId);

  const monthLabel = formatFinancialMonthLabel(new Date(), startDay);

  const net = data.monthIncome - data.monthExpenses;

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Balance</CardTitle>
          <Landmark className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(data.totalBalance)}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.accountCount} account
            {data.accountCount !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Income</CardTitle>
          <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(data.monthIncome)}
          </div>
          <p className="text-xs text-muted-foreground">{monthLabel}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Expenses</CardTitle>
          <TrendingDown className="h-4 w-4 text-red-500 dark:text-red-400" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {formatCurrency(data.monthExpenses)}
          </div>
          <p className="text-xs text-muted-foreground">{monthLabel}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Net</CardTitle>
          <span className="text-xs font-medium text-muted-foreground">
            {monthLabel}
          </span>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              net >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {formatCurrency(net)}
          </div>
          <p className="text-xs text-muted-foreground">
            {net >= 0 ? "Saved" : "Overspent"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function MonthSummaryGridSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-28 mb-1" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
