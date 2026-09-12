"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The band that opens the plan list: what it is, what it adds up to, and the
 * controls that change it.
 *
 * One band over one list — income, fixed costs and flexible spending are parts
 * of the same plan, so they queue under a single header rather than being cut
 * into sections with a row of controls wedged between them.
 */
export function SectionHeader({
  // The budget view draws its list two ways (rows in a card, or a grid of
  // cards) and the header belongs to neither, so there it sits outside both as
  // a plain div. Inside a list it stays an `<li>` — nothing else may.
  as: Tag = "li",
  className = "px-4 pb-2.5 pt-5",
  icon: Icon,
  label,
  note,
  action,
}: {
  as?: "li" | "div";
  className?: string;
  icon?: LucideIcon;
  label: string;
  /** What the rows under it add up to, in the unit they are shown in. */
  note?: ReactNode;
  /** Add/generate controls for the whole list. */
  action?: ReactNode;
}) {
  return (
    // No fill behind it: the band is set apart by the space above it and the
    // rule the list already draws, which keeps the card one surface instead of
    // striping it.
    <Tag className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </span>
      {/* ml-auto on whichever of the two is present keeps the trailing pair
          hugging the right edge, including when the label wraps to its own line. */}
      {note && (
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {note}
        </span>
      )}
      {/* ml-auto whether or not the note is there: on a phone the controls wrap
          onto a line of their own and should still hug the right edge rather
          than sit under the label. */}
      {action && (
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {action}
        </span>
      )}
    </Tag>
  );
}
