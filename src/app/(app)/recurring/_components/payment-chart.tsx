"use client";

import { useMemo, useState } from "react";
import type { RecurringPayment } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { formatTick, niceMax } from "@/app/(app)/insights/_components/chart-axis";

const CHART_HEIGHT = 200;
// Five ticks split a niceMax bound into round steps (€20 → 0/5/10/15/20).
const TICK_COUNT = 5;

/**
 * One column per payment, oldest left, so a price change reads as a step in
 * the skyline. A single series: the card title names it, so there's no legend;
 * the payments list under the chart is its table view. The plan's own amount
 * is the one dashed rule — a reference, not a reading.
 */
export function PaymentChart({
  payments,
  planned,
}: {
  /** Newest first, as the detail API returns them. */
  payments: RecurringPayment[];
  /** The plan's per-occurrence amount (absolute). */
  planned: number;
}) {
  const { t, formatCurrency, formatDate, formatMonthYear } = useI18n();
  const [hovered, setHovered] = useState<string | null>(null);

  const points = useMemo(
    () => [...payments].reverse().map((p) => ({ ...p, value: Math.abs(p.amount) })),
    [payments],
  );
  // Headroom above the tallest column, so the planned label never leaves the plot.
  const yMax = niceMax(Math.max(planned, ...points.map((p) => p.value)) * 1.1);
  const ticks = Array.from(
    { length: TICK_COUNT },
    (_, i) => (yMax * (TICK_COUNT - 1 - i)) / (TICK_COUNT - 1),
  );
  const plannedPct = (planned / yMax) * 100;

  if (points.length === 0) {
    return (
      <div
        style={{ height: CHART_HEIGHT }}
        className="flex items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground"
      >
        {t("recurring.detail.chartEmpty")}
      </div>
    );
  }

  return (
    <div>
      <div className="flex">
        {/* Y-axis — pushed down by the same pt-12 as the plot beside it. */}
        <div className="relative mt-12 w-10 shrink-0 pr-2" style={{ height: CHART_HEIGHT }}>
          {ticks.map((tick, i) => (
            <span
              key={i}
              className="absolute right-2 text-[10px] leading-none tabular-nums text-muted-foreground"
              style={{ top: `${(i / (ticks.length - 1)) * 100}%`, transform: "translateY(-50%)" }}
            >
              {formatTick(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          {/* The scroll container clips both ways, so the room the tooltip
              (pt-12, over the tallest column) and the month labels (pb-5, under
              the first and last) need is padding inside it. */}
          <div className="pb-5 pt-12" style={{ minWidth: Math.max(points.length * 10, 200) }}>
            <div className="relative" style={{ height: CHART_HEIGHT }}>
              {/* Hairline grid, solid; the baseline a step stronger. */}
              {ticks.map((_, i) => (
                <div
                  key={i}
                  className={`absolute inset-x-0 border-t ${i === ticks.length - 1 ? "border-border" : "border-border/50"}`}
                  style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
                />
              ))}

              <div className="absolute inset-0 flex items-end justify-center gap-0.5 px-1">
                {points.map((p, i) => {
                  const isHovered = hovered === p.id;
                  const edge = i === 0 ? "left-0" : i === points.length - 1 ? "right-0" : null;
                  const heightPct = (p.value / yMax) * 100;
                  return (
                    <div
                      key={p.id}
                      tabIndex={0}
                      role="img"
                      aria-label={`${formatDate(p.date)}: ${formatCurrency(p.value)}`}
                      className="relative flex h-full min-w-[6px] max-w-6 flex-1 flex-col justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onMouseEnter={() => setHovered(p.id)}
                      onMouseLeave={() => setHovered((h) => (h === p.id ? null : h))}
                      onFocus={() => setHovered(p.id)}
                      onBlur={() => setHovered((h) => (h === p.id ? null : h))}
                    >
                      {isHovered && (
                        <div
                          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2"
                          style={{ bottom: `calc(${heightPct}% + 8px)` }}
                        >
                          <div className="whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-xs text-background shadow-lg">
                            <span className="block font-semibold tabular-nums">
                              {formatCurrency(p.value)}
                            </span>
                            <span className="block opacity-70">{formatDate(p.date)}</span>
                          </div>
                        </div>
                      )}
                      <div
                        className={`w-full rounded-t transition-colors ${
                          isHovered
                            ? "bg-primary"
                            : hovered
                              ? "bg-muted-foreground/20"
                              : "bg-primary/40 dark:bg-primary/50"
                        }`}
                        style={{ height: `${Math.max(heightPct, 1)}%` }}
                      />
                      {/* First and last month only — the tooltip carries every exact date. */}
                      {edge && (
                        <span
                          className={`absolute top-full mt-1.5 whitespace-nowrap text-[10px] text-muted-foreground ${edge}`}
                        >
                          {formatMonthYear(p.date)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Planned amount */}
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/40"
                style={{ bottom: `${plannedPct}%` }}
              >
                <span className="absolute -top-4 right-1 rounded-sm bg-background/90 px-1 text-[10px] leading-tight text-muted-foreground">
                  {t("recurring.detail.planned", { amount: formatCurrency(planned) })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
