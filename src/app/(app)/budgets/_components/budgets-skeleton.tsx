"use client";

import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROW_GRID, CELL_BAR, CELL_AMOUNT, CELL_DELTA } from "./budget-row";
import { useI18n } from "@/lib/i18n/client";

function RowSkeleton() {
  return (
    <li className={ROW_GRID}>
      <Skeleton className="h-2 w-2 rounded-full" />
      <Skeleton className="h-3.5 w-32 max-w-full" />
      <div className={CELL_BAR}>
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <Skeleton className={`h-3.5 w-24 justify-self-end ${CELL_AMOUNT}`} />
      <Skeleton className={`h-3 w-16 justify-self-end ${CELL_DELTA}`} />
    </li>
  );
}

/**
 * Placeholder for the budgets page while its data loads. Mirrors the real
 * layout closely enough that nothing jumps when the data lands: same ledger
 * card, same row grid, fixed-costs card collapsed like its default state.
 */
export function BudgetsSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <Card className="py-6">
        <div className="space-y-5 px-4 sm:px-7">
          {/* Header. The title never depends on the fetch, so render it for
              real and only placeholder the parts that do. */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-56 max-w-full" />
              <h1 className="text-2xl font-bold tracking-tight">{t("budgets.fallbackTitle")}</h1>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Skeleton className="h-9 w-full sm:w-[160px]" />
              <Skeleton className="h-9 flex-1 sm:w-48 sm:flex-none" />
              <Skeleton className="h-9 flex-1 sm:w-36 sm:flex-none" />
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>

          {/* Split bar + legend */}
          <div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-3 w-24" />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-1 sm:px-7">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <ul className="divide-y sm:px-3">
            {Array.from({ length: 6 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </ul>
        </div>
      </Card>

      {/* Fixed costs — collapsed by default, so header only */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
        </CardHeader>
      </Card>
    </div>
  );
}
