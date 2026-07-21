"use client";

import type { Allocation } from "@/types/api";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { formatCurrency } from "@/lib/utils";
import { Pencil } from "lucide-react";

function statusColor(status: Allocation["status"]): { bar: string; text: string } {
  if (status === "exceeded") {
    return { bar: "#ef4444", text: "text-red-600 dark:text-red-400" };
  }
  if (status === "warning") {
    return { bar: "#f59e0b", text: "text-amber-600 dark:text-amber-400" };
  }
  return { bar: "", text: "text-muted-foreground" };
}

interface AllocationRowProps {
  alloc: Allocation;
  readOnly?: boolean;
  deletePending?: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

export function AllocationRow({
  alloc,
  readOnly = false,
  deletePending,
  onClick,
  onEdit,
  onDelete,
}: AllocationRowProps) {
  const colors = statusColor(alloc.status);
  const barColor = colors.bar || alloc.categoryColor || "#3b82f6";
  const remainingLabel =
    alloc.status === "exceeded"
      ? `${formatCurrency(alloc.spent - alloc.amount)} over`
      : `${formatCurrency(alloc.remaining)} left`;

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 cursor-pointer sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(140px,2fr)_auto_auto]"
    >
      {/* Color dot */}
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: alloc.categoryColor || "#94a3b8" }}
      />

      {/* Name + avg */}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{alloc.categoryName}</div>
        {alloc.avgMonthly > 0 && (
          <div className="truncate text-xs text-muted-foreground">
            avg {formatCurrency(alloc.avgMonthly)}/mo · {alloc.avgMonths} mo
          </div>
        )}
      </div>

      {/* Inline progress bar (desktop only) */}
      <div className="col-span-3 sm:col-span-1 sm:px-2 row-start-2 sm:row-start-auto">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(alloc.percentage, 100)}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
      </div>

      {/* Spent / Limit + status */}
      <div className="text-right tabular-nums text-sm row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto shrink-0">
        <div>
          <span className="font-medium">{formatCurrency(alloc.spent)}</span>
          <span className="text-muted-foreground">
            {" / "}
            {formatCurrency(alloc.amount)}
          </span>
        </div>
        <div className={`text-xs ${colors.text}`}>{remainingLabel}</div>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div
          className="flex items-center gap-0.5 row-start-1 col-start-3 justify-end sm:row-start-auto sm:col-start-auto sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <ConfirmDeleteButton onConfirm={onDelete} pending={deletePending} />
        </div>
      )}
    </li>
  );
}
