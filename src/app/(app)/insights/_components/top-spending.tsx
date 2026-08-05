"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractPattern } from "@/lib/csv-utils";
import { formatCurrency } from "@/lib/utils";

interface TopSpendingProps {
  merchants: { description: string; total: number; count: number }[];
  totalExpenses: number;
}

/**
 * Biggest spend lines with the bank's noise stripped off the name. The raw
 * description is one click away, since that's what you need when a line looks
 * unfamiliar.
 */
export function TopSpending({ merchants, totalExpenses }: TopSpendingProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const max = merchants[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">Top spending</CardTitle>
        <span className="text-xs text-muted-foreground">
          merchant names cleaned · click a row for the bank&apos;s wording
        </span>
      </CardHeader>
      <CardContent>
        {merchants.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No expense data for this period.
          </p>
        ) : (
          <div>
            {merchants.map((m, i) => {
              const name = extractPattern(m.description);
              const hasDetail = name !== m.description;
              const open = openIndex === i;
              const share =
                totalExpenses > 0 ? (m.total / totalExpenses) * 100 : 0;
              return (
                <div key={i}>
                  <button
                    type="button"
                    disabled={!hasDetail}
                    onClick={() => setOpenIndex(open ? null : i)}
                    aria-expanded={hasDetail ? open : undefined}
                    className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5 text-left transition-colors sm:grid-cols-[1.25rem_minmax(0,1fr)_8rem_9rem] ${
                      hasDetail
                        ? "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {i + 1}.
                    </span>
                    <span className="min-w-0 truncate">
                      <span className="text-sm font-medium">{name}</span>
                      {m.count > 1 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {m.count}×
                        </span>
                      )}
                    </span>
                    {/* Bar drops below the name on mobile, where there's no room beside it. */}
                    <div className="col-start-2 row-start-2 h-1 self-center overflow-hidden rounded-full bg-muted sm:col-auto sm:row-auto">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${max > 0 ? (m.total / max) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="col-start-3 row-start-1 text-right text-sm tabular-nums whitespace-nowrap sm:col-auto">
                      {formatCurrency(m.total)}
                      <span className="ml-2 inline-block min-w-[2.75rem] text-xs text-muted-foreground">
                        {share.toFixed(1)}%
                      </span>
                    </span>
                  </button>
                  {open && (
                    <p className="px-2 pb-2 pl-9 font-mono text-[11px] break-words text-muted-foreground">
                      {m.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
