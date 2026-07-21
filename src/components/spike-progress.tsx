"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatCurrency as fc } from "@/lib/utils";

export const ON_TRACK_LABEL = {
  ahead: "Ahead",
  on_pace: "On pace",
  behind: "Behind",
} as const;

export const ON_TRACK_STYLES = {
  ahead:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400",
  on_pace:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-400",
  behind:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-400",
} as const;

export type OnTrack = keyof typeof ON_TRACK_LABEL;

const FUNDED_BADGE =
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400";

const SIZES = {
  card: {
    header: "flex items-end justify-between gap-2",
    amount: "text-lg font-bold tabular-nums leading-none",
    amountSub: "text-xs font-normal text-muted-foreground",
    badge: "text-[10px] px-1.5 py-0 font-normal",
    bar: "h-1.5",
  },
  detail: {
    header: "flex items-end justify-between gap-3 flex-wrap",
    amount: "text-3xl font-bold tabular-nums leading-none",
    amountSub: "text-lg font-normal text-muted-foreground",
    badge: "text-xs px-2 py-0.5 font-medium",
    bar: "h-2.5",
  },
} as const;

interface SpikeProgressProps {
  funded: number;
  target: number;
  categoryColor: string | null;
  onTrack?: OnTrack;
  expectedFundedByNow?: number | null;
  size: "card" | "detail";
  /** Meta line rendered under the bar (day/payday copy, suggestion, etc). */
  meta?: ReactNode;
  /** Trailing content under the meta (e.g. the card's allocate button). */
  footer?: ReactNode;
}

/** Funded/target header, status badge, and progress bar — shared by pot card and pot detail. */
export function SpikeProgress({
  funded,
  target,
  categoryColor,
  onTrack,
  expectedFundedByNow,
  size,
  meta,
  footer,
}: SpikeProgressProps) {
  const s = SIZES[size];
  const pct = target > 0 ? Math.min(100, (funded / target) * 100) : 0;
  const expectedPct =
    expectedFundedByNow != null && target > 0
      ? Math.min(100, (expectedFundedByNow / target) * 100)
      : null;
  const isFullyFunded = funded >= target;

  return (
    <div className="space-y-2">
      <div className={s.header}>
        <p className={s.amount}>
          {fc(funded)}{" "}
          <span className={s.amountSub}>/ {fc(target)}</span>
        </p>
        {isFullyFunded ? (
          <Badge variant="outline" className={`${s.badge} ${FUNDED_BADGE}`}>
            Funded
          </Badge>
        ) : (
          onTrack && (
            <Badge variant="outline" className={`${s.badge} ${ON_TRACK_STYLES[onTrack]}`}>
              {ON_TRACK_LABEL[onTrack]}
            </Badge>
          )
        )}
      </div>

      <div className={`relative ${s.bar} bg-muted rounded-full overflow-hidden`}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: isFullyFunded
              ? "var(--color-success, #16a34a)"
              : categoryColor || "var(--color-primary)",
          }}
        />
        {!isFullyFunded && expectedPct != null && expectedPct > 0 && expectedPct <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-foreground/40"
            style={{ left: `${expectedPct}%` }}
            title={
              expectedFundedByNow != null
                ? `Expected by now: ${fc(expectedFundedByNow)}`
                : undefined
            }
          />
        )}
      </div>

      {meta}
      {footer}
    </div>
  );
}
