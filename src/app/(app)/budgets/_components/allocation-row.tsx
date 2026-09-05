"use client";

import { useState, type ReactNode } from "react";
import type { Allocation, YearlyCategoryView } from "@/types/api";
import type { SplitShare } from "@/lib/budget-split";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useI18n } from "@/lib/i18n/client";
import { ChevronRight, Loader2, Pencil } from "lucide-react";
import {
  ROW_SHELL,
  ROW_CHEVRON,
  ROW_ASIDE,
  ROW_INDENT,
  TONE,
  type Tone,
} from "./budget-row";

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
  /** "/mo" or "/yr" — which period the amount above is one of. */
  unit?: string;
  /** Quiet count beside the name saying there is something to expand into. */
  subNote?: string;
  /** Money in rather than out: the progress line says received, not spent. */
  flow?: "spend" | "income";
  /** A sentence above the fact line — the yearly carry-over breakdown. */
  note?: ReactNode;
  /** Inline facts shown before the history link when expanded. */
  facts?: ReactNode;
  /**
   * Who carries this line, on a shared budget. Empty or absent on a budget
   * nobody shares — and on income, which is received rather than paid.
   */
  split?: SplitShare[];
  readOnly?: boolean;
  /**
   * The row is an optimistic write still in flight: it shows what was asked
   * for, says so, and refuses a second change until the server has answered.
   */
  pending?: boolean;
  /** False when there is no allocation behind the row to edit or delete. */
  editable?: boolean;
  deletePending?: boolean;
  /** Omitted when the row has no category to look up — the link is hidden. */
  onHistory?: () => void;
  onEdit?: () => void;
  onDelete?: () => void | Promise<void>;
}

/**
 * The row itself: one line per category, with the detail it hides behind it.
 *
 * The budgeted amount is the row's headline and the spend sits under it in the
 * same column, because a plan is read as "what may this cost" first and "how is
 * it going" second. Everything that is only true sometimes — who pays, the
 * averages, the edit controls — waits behind the chevron.
 */
export function BudgetRow({
  name,
  color,
  tone: toneKey,
  badge,
  percentage,
  spent,
  limit,
  delta,
  unit,
  subNote,
  flow = "spend",
  note,
  facts,
  split,
  readOnly = false,
  pending = false,
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
  const spentLabel = t(
    flow === "income" ? "budgets.row.receivedAmount" : "budgets.row.spentAmount",
    { amount: formatCurrency(spent) },
  );
  const showSplit = !!split && split.length > 0 && limit > 0;

  return (
    // Faded while the write is in flight: the figures are what was asked for,
    // not yet what the server has confirmed.
    <li className={pending ? "opacity-60 transition-opacity" : undefined}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${ROW_SHELL} cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none`}
      >
        <ChevronRight
          className={`${ROW_CHEVRON} text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1">
          {/* Name, then whatever qualifies it. The badge is desktop-only: on a
              phone it cost a third of the name column to repeat what the
              coloured delta beside it already says. */}
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${spent === 0 ? "opacity-40" : ""}`}
              style={{ backgroundColor: color || "#94a3b8" }}
            />
            <span className="truncate text-sm font-medium sm:text-[0.9375rem]">
              {name}
            </span>
            {pending ? (
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
                aria-label={t("common.saving")}
              />
            ) : (
              badge && (
                <span
                  className={`hidden shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold sm:inline ${tone.badge}`}
                >
                  {badge}
                </span>
              )
            )}
            {subNote && (
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {subNote}
              </span>
            )}
          </span>

          {/* Aligned under the name rather than under the dot — the bar belongs
              to the category it is named after. */}
          <span className="ml-4 mt-2.5 block h-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(percentage, 100)}%`,
                backgroundColor: barColor,
              }}
            />
          </span>
        </span>

        <span className={ROW_ASIDE}>
          <span className="block whitespace-nowrap text-sm font-semibold tabular-nums sm:text-lg">
            {formatCurrency(limit)}
            {unit && (
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                {unit}
              </span>
            )}
          </span>
          {/* What has actually happened against that plan. On a phone only the
              half that carries the news survives — the spent figure is already
              a tap away and the column is 120px wide.

              From sm up each half is unbreakable, so a line too long for the
              column drops the whole phrase to the next line instead of
              stranding the last word of it ("…left this / year") under its own
              amount. Not below sm: at 120px a long phrase has to wrap
              somewhere, and wrapping beats spilling out of the column. */}
          <span className="mt-1 block text-xs tabular-nums text-muted-foreground sm:text-[0.8125rem]">
            <span
              className={
                delta ? "hidden sm:inline sm:whitespace-nowrap" : "sm:whitespace-nowrap"
              }
            >
              {spentLabel}
            </span>
            {delta && (
              <>
                <span className="hidden sm:inline"> · </span>
                <span className={`sm:whitespace-nowrap ${tone.text}`}>{delta}</span>
              </>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div
          className={`space-y-3 px-4 pb-4 text-xs text-muted-foreground ${ROW_INDENT}`}
        >
          {note}

          {/* Who pays what of this line, read down fixed right-aligned columns
              so the same person lands in the same place on every row and the
              budget can be read down a person as easily as across a category.
              A line with nothing budgeted is skipped: a column of zeroes says
              nothing the row above it doesn't already say. */}
          {showSplit && (
            <div className="space-y-1">
              <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_6rem] items-baseline gap-x-3 text-[10px] uppercase tracking-wider sm:grid-cols-[minmax(0,1fr)_2.75rem_6rem_6rem]">
                <span>{t("budgets.split.rowLabel")}</span>
                <span />
                <span className="text-right">{t("budgets.split.colBudgeted")}</span>
                <span className="hidden text-right sm:block">
                  {t("budgets.split.colSpent")}
                </span>
              </div>
              {split.map((person, i) => (
                <div
                  key={`${person.name}-${i}`}
                  className="grid grid-cols-[minmax(0,1fr)_2.75rem_6rem] items-baseline gap-x-3 sm:grid-cols-[minmax(0,1fr)_2.75rem_6rem_6rem]"
                >
                  {/* The NAME gives way, never the figure: an ellipsised amount
                      would read as a different number than the one budgeted. */}
                  <span className="truncate" title={person.name}>
                    {person.name}
                  </span>
                  {/* Rounded for the eye only: the euros beside it are worked
                      out from the exact share, so a key set in amounts (where
                      the percentage is derived) still adds back to the line. */}
                  <span className="tabular-nums">{Math.round(person.percent)}%</span>
                  <span className="text-right font-medium tabular-nums text-foreground">
                    {formatCurrency((limit * person.percent) / 100)}
                  </span>
                  <span className="hidden text-right tabular-nums sm:block">
                    {formatCurrency((spent * person.percent) / 100)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {facts}
            {onHistory && (
              <button
                type="button"
                onClick={onHistory}
                className="text-primary hover:underline"
              >
                {t("budgets.row.fullHistory")}
              </button>
            )}
            {/* Edit and delete travel separately: a fixed-cost category has
                something to budget for but no budget line to remove yet. */}
            {!readOnly && !pending && editable && (onEdit || onDelete) && (
              <span className="ml-auto flex items-center gap-0.5">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onEdit}
                    aria-label={t("common.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {onDelete && (
                  <ConfirmDeleteButton onConfirm={onDelete} pending={deletePending} />
                )}
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
  /** Who carries the budget; see BudgetRow. */
  split?: SplitShare[];
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
  const { t, plural, formatCurrency } = useI18n();

  return (
    <BudgetRow
      name={alloc.categoryName}
      color={alloc.categoryColor}
      tone={alloc.status}
      unit={t("budgets.perMonthShort")}
      subNote={
        alloc.subLines.length > 0
          ? plural(
              alloc.subLines.length,
              "budgets.row.subLines.one",
              "budgets.row.subLines.other",
            )
          : undefined
      }
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
      pending={alloc.pending}
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
  const { t, plural, formatCurrency } = useI18n();

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
      // Which period the headline amount is one of. A yearly plan shows both
      // scopes in the same list shape, so saying so is the difference between
      // an annual pot and a month's allowance.
      unit={t(scope === "year" ? "budgets.perYearShort" : "budgets.perMonthShort")}
      subNote={
        alloc && alloc.subLines.length > 0
          ? plural(
              alloc.subLines.length,
              "budgets.row.subLines.one",
              "budgets.row.subLines.other",
            )
          : undefined
      }
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
      // In year scope the "/yr" beside the headline already says which year
      // this is left of, so the row drops the words and keeps the figure.
      // Month scope still needs them: the headline there is the month's
      // allowance, and the annual position beside it would read as the month's.
      delta={t(
        scope === "year" ? "budgets.row.leftAmount" : "budgets.yearly.leftThisYear",
        { amount: formatCurrency(category.remainingYear) },
      )}
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
      pending={alloc?.pending}
      {...actions}
    />
  );
}
