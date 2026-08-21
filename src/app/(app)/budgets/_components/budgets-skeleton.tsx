"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROW_SHELL, ROW_CHEVRON, ROW_ASIDE } from "./budget-row";
import { useI18n } from "@/lib/i18n/client";

function RowSkeleton() {
  return (
    <li className={ROW_SHELL}>
      <Skeleton className={ROW_CHEVRON} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-32 max-w-full" />
        </div>
        <Skeleton className="ml-4 mt-2.5 h-1 w-full rounded-full" />
      </div>
      <div className={ROW_ASIDE}>
        <Skeleton className="ml-auto h-5 w-20" />
        <Skeleton className="ml-auto mt-1.5 h-3 w-28 max-w-full" />
      </div>
    </li>
  );
}

/** The band that opens each section of the plan list. */
function SectionSkeleton({ action = false }: { action?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2.5 pt-5">
      <Skeleton className="h-3.5 w-3.5 shrink-0" />
      <Skeleton className="h-3 w-28" />
      <Skeleton className="ml-auto h-3 w-32 max-w-[30%]" />
      {/* Reserve the action's height, not just its width — without it the
          band grows when the buttons land and pushes every row down. On a
          phone the controls take a line of their own, as they do for real. */}
      {action && (
        <Skeleton className="ml-auto h-9 w-56 max-w-full shrink-0 sm:h-8 sm:w-24" />
      )}
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
        <h1 className="text-2xl font-bold tracking-tight lg:text-[1.75rem]">
          {t("budgets.fallbackTitle")}
        </h1>
        {/* Phone folds these into the title's menu — see BudgetSwitcher. */}
        <Skeleton className="ml-auto hidden h-8 w-20 sm:block" />
        <Skeleton className="hidden h-8 w-32 sm:block" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-9 flex-1 sm:w-44 sm:flex-none" />
        <Skeleton className="h-4 w-9 shrink-0 sm:w-36" />
      </div>

      {/* Stat strip: one meter on a phone, four stats from sm up. */}
      <div className="border-b pb-6">
        <div className="sm:hidden">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-8 w-40" />
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
          <Skeleton className="mt-2.5 h-3 w-56 max-w-full" />
        </div>
        <div className="hidden gap-x-6 gap-y-5 sm:grid sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-1.5 h-7 w-28 max-w-full" />
              <Skeleton className="mt-1.5 h-3 w-28 max-w-full" />
            </div>
          ))}
        </div>
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
