"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractPattern } from "@/lib/csv-utils";
import { useI18n } from "@/lib/i18n/client";

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
  const { t, formatCurrency } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const max = merchants[0]?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">{t("insights.topSpending.title")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t("insights.topSpending.hint")}
        </span>
      </CardHeader>
      <CardContent>
        {merchants.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            {t("insights.topSpending.empty")}
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
                  {/* The name track is the only flexible one, so it soaks up
                      whatever the bar and the amount don't need. The bar grows
                      in steps rather than continuously — fixed tracks keep the
                      amounts of every row lined up under each other. */}
                  <button
                    type="button"
                    disabled={!hasDetail}
                    onClick={() => setOpenIndex(open ? null : i)}
                    aria-expanded={hasDetail ? open : undefined}
                    className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5 text-left transition-colors sm:grid-cols-[1.25rem_minmax(0,1fr)_7rem_9rem] md:grid-cols-[1.25rem_minmax(0,1fr)_10rem_9rem] lg:grid-cols-[1.25rem_minmax(0,1fr)_14rem_9rem] ${
                      hasDetail
                        ? "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {i + 1}.
                    </span>
                    <span className="flex min-w-0 items-baseline gap-2">
                      {/* Only the name itself clips; the repeat count stays put. */}
                      <span className="truncate text-sm font-medium" title={name}>
                        {name}
                      </span>
                      {m.count > 1 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {m.count}×
                        </span>
                      )}
                    </span>
                    {/* Bar drops below the name on mobile, where there's no room
                        beside it. Placed only under `sm`, so nothing has to be
                        unset again on wider screens. */}
                    <div className="h-1 self-center overflow-hidden rounded-full bg-muted max-sm:col-start-2 max-sm:row-start-2">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${max > 0 ? (m.total / max) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-right text-sm tabular-nums whitespace-nowrap max-sm:col-start-3 max-sm:row-start-1">
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
