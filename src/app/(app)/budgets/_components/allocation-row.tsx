"use client";

import { useState, type ReactNode } from "react";
import type { Allocation, YearlyCategoryView } from "@/types/api";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useI18n } from "@/lib/i18n/client";
import { ChevronDown, Pencil } from "lucide-react";
import { ROW_GRID, CELL_BAR, CELL_AMOUNT, CELL_DELTA } from "./budget-row";

/**
 * Red for spent-out, amber for tight. A monthly allocation and a yearly
 * envelope disagree about what those mean — over the month's cap versus out of
 * the annual pot — but they look the same and say the same thing, so they
 * share one palette and one row.
 */
const TONE = {
  exceeded: {
    bar: "#ef4444",
    text: "text-red-600 dark:text-red-400",
    badge: "border-red-500/40 text-red-600 dark:text-red-400",
  },
  warning: {
    bar: "#f59e0b",
    text: "text-amber-600 dark:text-amber-400",
    badge: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  },
  ok: { bar: "", text: "text-muted-foreground", badge: "" },
} as const;

type Tone = keyof typeof TONE;

interface BudgetRowProps {
  name: string | null;
  color: string | null;
  tone: Tone;
  /** Short label beside the name; absent when the row is healthy. */
  badge?: string;
  percentage: number;
  spent: number;
  limit: number;
  /** The right-hand figure: what is left, or what it went over by. */
  delta: string;
  /** A sentence above the fact line — the yearly carry-over breakdown. */
  note?: ReactNode;
  /** Inline facts shown before the history link when expanded. */
  facts?: ReactNode;
  readOnly?: boolean;
  /** False when there is no allocation behind the row to edit or delete. */
  editable?: boolean;
  deletePending?: boolean;
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

/** The row itself: one line per category, with the detail it hides behind it. */
function BudgetRow({
  name,
  color,
  tone: toneKey,
  badge,
  percentage,
  spent,
  limit,
  delta,
  note,
  facts,
  readOnly = false,
  editable = true,
  deletePending,
  onHistory,
  onEdit,
  onDelete,
}: BudgetRowProps) {
  const { t, formatCurrency } = useI18n();
  const [open, setOpen] = useState(false);
  const tone = TONE[toneKey];
  const barColor = tone.bar || color || "#3b82f6";

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
          className={`h-2 w-2 shrink-0 rounded-full ${spent === 0 ? "opacity-40" : ""}`}
          style={{ backgroundColor: color || "#94a3b8" }}
        />

        {/* Name + status badge */}
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          {badge && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold ${tone.badge}`}
            >
              {badge}
            </span>
          )}
        </span>

        {/* Progress */}
        <span className={`block ${CELL_BAR}`}>
          <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(percentage, 100)}%`,
                backgroundColor: barColor,
              }}
            />
          </span>
        </span>

        {/* Spent / limit */}
        <span
          className={`whitespace-nowrap text-right text-sm tabular-nums ${CELL_AMOUNT}`}
        >
          <span className="font-medium">{formatCurrency(spent)}</span>
          <span className="text-muted-foreground">
            {" / "}
            {formatCurrency(limit)}
          </span>
        </span>

        {/* Over / left, with the disclosure caret the whole row toggles */}
        <span
          className={`flex items-center justify-end gap-1.5 text-xs tabular-nums ${tone.text} ${CELL_DELTA}`}
        >
          <span className="truncate">{delta}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 px-4 pb-3 pl-9 text-xs text-muted-foreground">
          {note}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {facts}
            <button
              type="button"
              onClick={onHistory}
              className="text-primary hover:underline"
            >
              {t("budgets.row.fullHistory")}
            </button>
            {!readOnly && editable && (
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
        </div>
      )}
    </li>
  );
}

interface RowActions {
  readOnly?: boolean;
  deletePending?: boolean;
  /** Opens the full history dialog. */
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

/** One category of a monthly plan: spend against a flat cap. */
export function AllocationRow({
  alloc,
  ...actions
}: { alloc: Allocation } & RowActions) {
  const { t, formatCurrency } = useI18n();

  return (
    <BudgetRow
      name={alloc.categoryName}
      color={alloc.categoryColor}
      tone={alloc.status}
      badge={
        alloc.status === "exceeded"
          ? t("budgets.row.over")
          : alloc.status === "warning"
            ? t("budgets.row.tight")
            : undefined
      }
      percentage={alloc.percentage}
      spent={alloc.spent}
      limit={alloc.amount}
      delta={
        alloc.status === "exceeded"
          ? t("budgets.row.overAmount", {
              amount: formatCurrency(alloc.spent - alloc.amount),
            })
          : t("budgets.row.leftAmount", { amount: formatCurrency(alloc.remaining) })
      }
      facts={
        <>
          {alloc.avgMonthly > 0 && (
            <span>
              {t("budgets.row.avgPerMonth", {
                amount: formatCurrency(alloc.avgMonthly),
                months: alloc.avgMonths,
              })}
            </span>
          )}
          <span>
            {t("budgets.row.pctUsed", { pct: Math.round(alloc.percentage) })}
          </span>
        </>
      }
      {...actions}
    />
  );
}

/** year-over is spent out for good; month-over is only ahead of pace. */
const YEARLY_TONE: Record<YearlyCategoryView["status"], Tone> = {
  "year-over": "exceeded",
  "month-over": "warning",
  ok: "ok",
};

/**
 * One category of a yearly envelope.
 *
 * In month scope the bar is this month's spend against its carry-over-adjusted
 * allowance, not against a flat twelfth — that allowance is the number the user
 * can actually spend today. The annual position sits underneath, because the
 * month is the decision and the year is the context.
 */
export function YearlyAllocationRow({
  category,
  alloc,
  scope = "month",
  ...actions
}: {
  category: YearlyCategoryView;
  /** The matching monthly allocation, for edit/delete and the averages. */
  alloc: Allocation | undefined;
  /** "month" measures against this month's allowance, "year" against the pot. */
  scope?: "month" | "year";
} & RowActions) {
  const { t, formatCurrency } = useI18n();

  // A negative allowance means the earlier months already spent this one.
  const spendable =
    scope === "year" ? category.annualAmount : Math.max(0, category.allowance);
  const spent = scope === "year" ? category.spentYear : category.spentMonth;
  const carriedIn = Math.round(category.rolloverIn * 100) / 100;

  return (
    <BudgetRow
      name={category.categoryName}
      color={category.categoryColor}
      tone={YEARLY_TONE[category.status]}
      badge={
        category.status === "ok"
          ? undefined
          : t(
              category.status === "year-over"
                ? "budgets.yearly.badge.yearOver"
                : "budgets.yearly.badge.monthOver",
            )
      }
      percentage={spendable > 0 ? (spent / spendable) * 100 : 100}
      spent={spent}
      limit={scope === "year" ? category.annualAmount : category.allowance}
      delta={t("budgets.yearly.leftThisYear", {
        amount: formatCurrency(category.remainingYear),
      })}
      note={
        // Where this month's allowance came from — the whole point of a yearly
        // budget is that this line can differ from the plain share.
        scope === "month" ? (
          <p>
            {t("budgets.yearly.breakdown", {
              share: formatCurrency(category.monthTarget),
              carried:
                carriedIn >= 0
                  ? t("budgets.yearly.carriedSaved", {
                      amount: formatCurrency(carriedIn),
                    })
                  : t("budgets.yearly.carriedOwed", {
                      amount: formatCurrency(Math.abs(carriedIn)),
                    }),
              allowance: formatCurrency(category.allowance),
            })}
          </p>
        ) : undefined
      }
      facts={
        <>
          <span>
            {t("budgets.yearly.yearProgress", {
              spent: formatCurrency(category.spentYear),
              pot: formatCurrency(category.annualAmount),
            })}
          </span>
          {alloc && alloc.avgMonthly > 0 && (
            <span>
              {t("budgets.row.avgPerMonth", {
                amount: formatCurrency(alloc.avgMonthly),
                months: alloc.avgMonths,
              })}
            </span>
          )}
        </>
      }
      editable={!!alloc}
      {...actions}
    />
  );
}
