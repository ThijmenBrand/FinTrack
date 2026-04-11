import { ArrowUp, ArrowDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getWeeklySpending, formatCurrency } from "../_lib/dashboard-queries";

export async function HeroWeeklySpending({ userId }: { userId: string }) {
  const data = await getWeeklySpending(userId);

  const weekDiff =
    data.lastWeekExpenses > 0
      ? ((data.weekExpenses - data.lastWeekExpenses) / data.lastWeekExpenses) *
        100
      : 0;
  const weekUp = weekDiff > 0;

  const wStart = new Date(data.weekStart + "T12:00:00");
  const wEnd = new Date(data.weekEnd + "T12:00:00");
  const weekLabel = `${wStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${wEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Spent this week
          </p>
          <div className="text-5xl sm:text-6xl font-black tracking-tight text-foreground">
            {formatCurrency(data.weekExpenses)}
          </div>
          <p className="text-sm text-muted-foreground mt-2">{weekLabel}</p>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-2">
          {data.lastWeekExpenses > 0 && (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                weekUp
                  ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
              }`}
            >
              {weekUp ? (
                <ArrowUp className="h-3.5 w-3.5" />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" />
              )}
              {Math.abs(Math.round(weekDiff))}% vs last week
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Last week: {formatCurrency(data.lastWeekExpenses)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function HeroWeeklySpendingSkeleton() {
  return (
    <div className="rounded-2xl border-2 border-border bg-card p-6 sm:p-8 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
        <div>
          <Skeleton className="h-4 w-28 mb-3" />
          <Skeleton className="h-14 w-56" />
          <Skeleton className="h-4 w-40 mt-3" />
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}
