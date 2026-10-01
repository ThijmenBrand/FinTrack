"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/client";

/** Rows on a first paint: enough to fill the fold, not a whole page of 25. */
const ROWS = 8;

// Description widths cycle so the block reads as a list, not a barcode.
const WIDTHS = ["w-40", "w-52", "w-32", "w-48", "w-36", "w-56", "w-44", "w-28"];

/**
 * Placeholder body for the desktop table while the first page loads. Mirrors
 * `TransactionRow`'s cells one for one, so the real rows land in the same
 * columns without the table re-flowing — count the cells against it if a
 * column is ever added there.
 */
export function TransactionRowsSkeleton({
  showCreator,
  rows = ROWS,
}: {
  showCreator: boolean;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          <TableCell>
            <Skeleton className="h-4 w-4 rounded-sm" />
          </TableCell>
          {showCreator && (
            <TableCell>
              <Skeleton className="h-6 w-6 rounded-full" />
            </TableCell>
          )}
          <TableCell className="whitespace-nowrap">
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className={`h-4 max-w-full ${WIDTHS[i % WIDTHS.length]}`} />
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-8 w-28 rounded-md" />
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-4 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-7 w-7 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** The phone layout's counterpart: icon, two lines of text, an amount. */
export function TransactionCardsSkeleton({ rows = ROWS }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={`h-4 max-w-full ${WIDTHS[i % WIDTHS.length]}`} />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Simple mode's list rows: category icon, description, date, category pill,
 * amount — the same flex grid `SimpleTransactionList` lays its rows on.
 */
export function SimpleRowsSkeleton({ rows = ROWS }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={`h-4 max-w-full ${WIDTHS[i % WIDTHS.length]}`} />
            <Skeleton className="h-3 w-24 sm:hidden" />
          </div>
          <Skeleton className="hidden h-4 w-20 shrink-0 sm:block" />
          <Skeleton className="hidden h-8 w-28 shrink-0 rounded-md sm:block" />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Stand-in for `PaginationBar` so the card keeps its footer height. */
export function PaginationBarSkeleton() {
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 sm:flex-row">
      <Skeleton className="h-4 w-32" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 sm:w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-8 sm:w-20" />
      </div>
    </div>
  );
}

/**
 * The whole page before it has mounted: route-level `loading.tsx` and the
 * page's own Suspense fallback. Only the bits that never depend on data —
 * the title and column labels — render for real; everything else is a
 * placeholder in the same spot the real control takes.
 */
export function TransactionsPageSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("tx.title")}</h1>
          <p className="text-muted-foreground">{t("tx.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 sm:w-28" />
          <Skeleton className="h-8 w-8 sm:w-36" />
          <Skeleton className="h-8 w-8 sm:w-32" />
          <Skeleton className="h-8 w-8 sm:w-28" />
        </div>
      </div>

      {/* The filter bar's shell: same min height as the real input. */}
      <Skeleton className="min-h-[40px] w-full rounded-md" />

      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="hidden h-9 w-[130px] sm:block" />
        </div>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]">
                  <Skeleton className="h-4 w-4 rounded-sm" />
                </TableHead>
                <TableHead className="whitespace-nowrap">{t("common.date")}</TableHead>
                <TableHead>{t("common.description")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("common.account")}</TableHead>
                <TableHead>{t("common.category")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("common.type")}</TableHead>
                <TableHead className="text-right whitespace-nowrap">{t("common.amount")}</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TransactionRowsSkeleton showCreator={false} />
            </TableBody>
          </Table>
        </div>
        <div className="md:hidden">
          <TransactionCardsSkeleton />
        </div>
        <PaginationBarSkeleton />
      </div>
    </div>
  );
}
