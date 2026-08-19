"use client";

import type { ReactNode } from "react";
import { ROW_GRID, CELL_BAR, CELL_AMOUNT, CELL_DELTA } from "./budget-row";

interface CategoryProgressRowProps {
  color: string;
  name: string;
  amount: ReactNode;
  /** Trailing column — the "left"/"due" note beside the amount. */
  delta?: ReactNode;
  /** Progress fill percentage; omit/null to hide the bar. */
  progressPct?: number | null;
  /** Fill colour, from the shared TONE palette — falls back to the category's. */
  barColor?: string;
}

/**
 * A category's planned-vs-paid line in the budget list.
 *
 * Deliberately inert: it heads the recurring plans nested under it, and those
 * rows carry the controls. Clicking it used to jump to the category's
 * transactions, which took the click away from the plans it introduces.
 *
 * Shares its column template with the allocation rows so both lists line up.
 */
export function CategoryProgressRow({
  color,
  name,
  amount,
  delta,
  progressPct = null,
  barColor,
}: CategoryProgressRowProps) {
  return (
    <li className={ROW_GRID}>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
      </div>
      <div className={CELL_BAR}>
        {progressPct !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                backgroundColor: barColor || color,
              }}
            />
          </div>
        )}
      </div>
      <div
        className={`whitespace-nowrap text-right text-xs tabular-nums sm:text-sm ${CELL_AMOUNT}`}
      >
        {amount}
      </div>
      <div className={`truncate text-xs tabular-nums ${CELL_DELTA}`}>
        {delta}
      </div>
    </li>
  );
}
