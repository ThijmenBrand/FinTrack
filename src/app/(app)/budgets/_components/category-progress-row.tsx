"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

interface CategoryProgressRowProps {
  categoryId: string;
  color: string;
  name: string;
  amount: ReactNode;
  subtitle?: ReactNode;
  /** Progress fill percentage; omit/null to hide the bar. */
  progressPct?: number | null;
  barClassName?: string;
  dotClassName?: string;
  hoverClassName?: string;
}

/**
 * Clickable list row that navigates to the category's transactions.
 * Used by the Fixed Costs list.
 */
export function CategoryProgressRow({
  categoryId,
  color,
  name,
  amount,
  subtitle,
  progressPct = null,
  barClassName = "bg-slate-400",
  dotClassName = "rounded-full",
  hoverClassName = "hover:bg-muted/50",
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
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${hoverClassName}`}
    >
      <span
        className={`h-2.5 w-2.5 shrink-0 ${dotClassName}`}
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="truncate text-sm font-medium">{name}</span>
          {amount}
        </div>
        {subtitle}
        {progressPct !== null && (
          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClassName}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>
    </li>
  );
}
