"use client";

import { Card } from "@/components/ui/card";
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

/** The band that opens each section of the plan list. */
function SectionSkeleton({ action = false }: { action?: boolean }) {
  return (
    <li className="flex items-center gap-3 bg-muted/40 px-4 py-2">
      <Skeleton className="h-3.5 w-3.5 shrink-0" />
      <Skeleton className="h-3 w-28" />
      <Skeleton className="ml-auto h-3 w-32 max-w-[30%]" />
      {/* Reserve the action's height, not just its width — without it the
          band grows when the buttons land and pushes every row down. */}
      {action && <Skeleton className="h-8 w-24 shrink-0" />}
    </li>
  );
}

/**
 * Placeholder for the budgets page while its data loads. Mirrors the real
 * layout closely enough that nothing jumps when the data lands: same stat
 * strip, one card holding the whole plan, same section bands and row grid.
 */
export function BudgetsSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      {/* Header. The title never depends on the fetch, so render it for real
          and only placeholder the parts that do. */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("budgets.fallbackTitle")}
        </h1>
        <Skeleton className="ml-auto h-8 w-20" />
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-36" />
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b pb-6 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      {/* One card, three sections: flexible spending, income, fixed costs. */}
      <Card className="overflow-hidden">
        <ul className="divide-y">
          <SectionSkeleton action />
          {Array.from({ length: 5 }, (_, i) => (
            <RowSkeleton key={`alloc-${i}`} />
          ))}
          <SectionSkeleton />
          <RowSkeleton />
          <SectionSkeleton action />
          {Array.from({ length: 2 }, (_, i) => (
            <RowSkeleton key={`fixed-${i}`} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
