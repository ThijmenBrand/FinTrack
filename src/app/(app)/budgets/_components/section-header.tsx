"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The band that opens one section of the plan list: what it is, what it costs,
 * and the one control that changes it.
 *
 * Every section of the budget uses this same band — income, fixed costs and
 * flexible spending are three parts of one plan, so they get one grammar
 * rather than three cards with three different headers.
 */
export function SectionHeader({
  icon: Icon,
  label,
  note,
  action,
  iconClassName = "",
}: {
  icon: LucideIcon;
  label: string;
  /** The section's total, in the same unit as the rows under it. */
  note?: ReactNode;
  /** Add/generate controls for this section only. */
  action?: ReactNode;
  iconClassName?: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/40 px-4 py-2">
      <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${iconClassName}`} aria-hidden="true" />
        {label}
      </span>
      {/* ml-auto on whichever of the two is present keeps the trailing pair
          hugging the right edge, including when the label wraps to its own line. */}
      {note && (
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {note}
        </span>
      )}
      {action && (
        <span className={`flex items-center gap-1 ${note ? "" : "ml-auto"}`}>
          {action}
        </span>
      )}
    </li>
  );
}
