"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Calendar, Pencil, RefreshCcw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { RecurringTx } from "@/types/api";

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export function RecurringItem({
  item,
  onEdit,
  onDelete,
  onToggle,
}: {
  item: RecurringTx;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 group ${!item.isActive ? "opacity-50" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {item.description}
          </span>
          {item.categoryName && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              {item.categoryName}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span>{FREQ_LABELS[item.frequency]}</span>
          <span>&middot;</span>
          <span>{item.accountName}</span>
          {item.nextOccurrence && (
            <>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Next:{" "}
                {new Date(item.nextOccurrence).toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </>
          )}
        </div>
      </div>
      <span
        className={`text-sm font-semibold shrink-0 ${item.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
      >
        {item.type === "income" ? "+" : ""}
        {formatCurrency(Math.abs(item.amount))}
      </span>
      <div className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onToggle(item)}
          title={item.isActive ? "Pause" : "Activate"}
        >
          <RefreshCcw
            className={`h-3 w-3 ${item.isActive ? "text-green-500 dark:text-green-400" : "text-muted-foreground"}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(item)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <ConfirmDeleteButton
          onConfirm={() => onDelete(item.id)}
          label="Delete recurring item"
        />
      </div>
    </div>
  );
}
