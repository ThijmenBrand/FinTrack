"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ROW_GRID, CELL_BAR, CELL_AMOUNT, CELL_DELTA } from "./budget-row";

interface CategoryProgressRowProps {
  categoryId: string;
  color: string;
  name: string;
  amount: ReactNode;
  /** Trailing column — the "left"/"due" note beside the amount. */
  delta?: ReactNode;
  subtitle?: ReactNode;
  /** Progress fill percentage; omit/null to hide the bar. */
  progressPct?: number | null;
  barClassName?: string;
  dotClassName?: string;
  hoverClassName?: string;
}

/**
 * Clickable list row that navigates to the category's transactions.
 * Shares its column template with the allocation rows so both lists line up.
 */
export function CategoryProgressRow({
  categoryId,
  color,
  name,
  amount,
  delta,
  subtitle,
  progressPct = null,
  barClassName = "bg-slate-400",
  dotClassName = "rounded-full",
  hoverClassName = "hover:bg-muted/50 focus-visible:bg-muted/50",
}: CategoryProgressRowProps) {
  const router = useRouter();
  const go = () => router.push(`/transactions?category=${categoryId}`);

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      className={`cursor-pointer transition-colors focus-visible:outline-none ${hoverClassName} ${ROW_GRID}`}
    >
      <span
        className={`h-2 w-2 shrink-0 ${dotClassName}`}
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        {subtitle}
      </div>
      <div className={CELL_BAR}>
        {progressPct !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClassName}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>
      <div
        className={`whitespace-nowrap text-right text-sm tabular-nums ${CELL_AMOUNT}`}
      >
        {amount}
      </div>
      <div className={`whitespace-nowrap text-xs tabular-nums ${CELL_DELTA}`}>
        {delta}
      </div>
    </li>
  );
}
