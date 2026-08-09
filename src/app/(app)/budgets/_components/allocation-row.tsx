"use client";

import { useState } from "react";
import type { Allocation } from "@/types/api";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { Pencil } from "lucide-react";
import {
  ROW_GRID,
  CELL_BAR,
  CELL_AMOUNT,
  CELL_DELTA,
} from "./budget-row";

const TONE = {
  exceeded: {
    bar: "#ef4444",
    text: "text-red-600 dark:text-red-400",
    badge: "border-red-500/40 text-red-600 dark:text-red-400",
    labelKey: "budgets.row.over" as MessageKey,
  },
  warning: {
    bar: "#f59e0b",
    text: "text-amber-600 dark:text-amber-400",
    badge: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    labelKey: "budgets.row.tight" as MessageKey,
  },
  ok: { bar: "", text: "text-muted-foreground", badge: "", labelKey: null },
} as const;

interface AllocationRowProps {
  alloc: Allocation;
  readOnly?: boolean;
  deletePending?: boolean;
  /** Opens the full history dialog. */
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

export function AllocationRow({
  alloc,
  readOnly = false,
  deletePending,
  onHistory,
  onEdit,
  onDelete,
}: AllocationRowProps) {
  const { t, formatCurrency } = useI18n();
  const [open, setOpen] = useState(false);
  const tone = TONE[alloc.status];
  const untouched = alloc.spent === 0;
  const barColor = tone.bar || alloc.categoryColor || "#3b82f6";

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full cursor-pointer text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none ${ROW_GRID}`}
      >
        {/* Color dot */}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${untouched ? "opacity-40" : ""}`}
          style={{ backgroundColor: alloc.categoryColor || "#94a3b8" }}
        />

        {/* Name + status badge */}
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {alloc.categoryName}
          </span>
          {tone.labelKey && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold ${tone.badge}`}
            >
              {t(tone.labelKey)}
            </span>
          )}
        </span>

        {/* Progress */}
        <span className={`block ${CELL_BAR}`}>
          <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(alloc.percentage, 100)}%`,
                backgroundColor: barColor,
              }}
            />
          </span>
        </span>

        {/* Spent / limit */}
        <span
          className={`whitespace-nowrap text-right text-sm tabular-nums ${CELL_AMOUNT}`}
        >
          <span className="font-medium">{formatCurrency(alloc.spent)}</span>
          <span className="text-muted-foreground">
            {" / "}
            {formatCurrency(alloc.amount)}
          </span>
        </span>

        {/* Over / left */}
        <span
          className={`whitespace-nowrap text-xs tabular-nums ${tone.text} ${CELL_DELTA}`}
        >
          {alloc.status === "exceeded"
            ? t("budgets.row.overAmount", {
                amount: formatCurrency(alloc.spent - alloc.amount),
              })
            : t("budgets.row.leftAmount", { amount: formatCurrency(alloc.remaining) })}
        </span>
      </button>

      {open && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-3 pl-9 text-xs text-muted-foreground">
          {alloc.avgMonthly > 0 && (
            <span>
              {t("budgets.row.avgPerMonth", {
                amount: formatCurrency(alloc.avgMonthly),
                months: alloc.avgMonths,
              })}
            </span>
          )}
          <span>{t("budgets.row.pctUsed", { pct: Math.round(alloc.percentage) })}</span>
          <button
            type="button"
            onClick={onHistory}
            className="text-primary hover:underline"
          >
            {t("budgets.row.fullHistory")}
          </button>
          {!readOnly && (
            <span className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onEdit}
                aria-label={t("common.edit")}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <ConfirmDeleteButton onConfirm={onDelete} pending={deletePending} />
            </span>
          )}
        </div>
      )}
    </li>
  );
}
