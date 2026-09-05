"use client";

import type { ReactNode } from "react";
import { Repeat } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { relativeDay } from "@/app/(app)/recurring/_components/dates";
import { FREQ_LABEL_KEYS } from "@/app/(app)/recurring/_components/recurring-item";
import { CELL_ACTIONS, CELL_AMOUNT, SUB_ROW_GRID, SUB_ROW_INDENT } from "./budget-row";

/**
 * One line under a category — a sub-line of its allocation, or a recurring
 * plan it pays.
 *
 * Those two arrived from opposite ends of the app and used to look it: one was
 * a muted flex row whose amount floated wherever the name ended, the other a
 * bold grid row with a signed red figure. Read down a category they looked like
 * two different kinds of thing, which they aren't — both are a named slice of
 * the cap in the row above. So there is one row, and it is this one; whichever
 * side supplies the content, the dot, the type, the columns and the hover
 * behave identically.
 *
 * Everything subordinates to the category row above it: regular weight against
 * its medium, `text-sm` against its `0.9375rem`, and no progress bar. Only the
 * amount column is shared outright, so the figures line up top to bottom.
 */
export function SubRow({
  color,
  depth = 1,
  name,
  /** Badges that qualify the name — paused, which account it debits. */
  nameSuffix,
  /** The second line: `PlanMeta`, or nothing on a plain sub-line. */
  meta,
  amount,
  /** A quieter figure under the amount — what is really charged, and when. */
  amountNote,
  /** Rendered into the controls track; revealed on hover from sm up. */
  actions,
  /** Paused or otherwise not counting: the row dims and strikes through. */
  muted = false,
  /** An optimistic write for this row is still in flight. */
  pending = false,
}: {
  color: string | null;
  depth?: number;
  name: ReactNode;
  nameSuffix?: ReactNode;
  meta?: ReactNode;
  amount: ReactNode;
  amountNote?: ReactNode;
  actions?: ReactNode;
  muted?: boolean;
  pending?: boolean;
}) {
  return (
    <li
      className={`group transition-colors hover:bg-muted/50 ${SUB_ROW_GRID} ${SUB_ROW_INDENT[depth - 1] ?? SUB_ROW_INDENT[0]}${
        pending ? " opacity-60" : ""
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${muted ? "opacity-40" : ""}`}
        style={{ backgroundColor: color || "#94a3b8" }}
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm ${
              muted
                ? "text-muted-foreground line-through decoration-muted-foreground/40"
                : ""
            }`}
          >
            {name}
          </span>
          {nameSuffix}
        </div>
        {meta}
      </div>

      {/* Quiet until the row is pointed at, so the column of amounts stays the
          thing being read. Opacity, not display: the row must not re-flow under
          the cursor. Touch has no hover, so it keeps them. Full contrast even
          on a muted row — pausing must not dim the control that undoes it. */}
      {actions && (
        <div
          className={`flex items-center justify-end gap-0.5 text-muted-foreground transition-opacity ${
            pending
              ? ""
              : "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:has-[[data-confirming]]:opacity-100"
          } ${CELL_ACTIONS}`}
        >
          {actions}
        </div>
      )}

      <div className={`text-right tabular-nums ${CELL_AMOUNT}`}>
        <div
          className={`whitespace-nowrap text-sm font-medium ${muted ? "text-muted-foreground" : ""}`}
        >
          {amount}
        </div>
        {amountNote && (
          <div className="whitespace-nowrap text-xs text-muted-foreground">
            {amountNote}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * "Paused" — the plan still exists but owes nothing this period. Lives here so
 * a linked sub-line and a plan row wear exactly the same mark.
 */
export function PausedBadge() {
  const { t } = useI18n();
  return (
    <span className="shrink-0 rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {t("recurring.paused")}
    </span>
  );
}

/**
 * The second line of a plan-backed row: how often it repeats and when it next
 * lands. The repeat mark is what separates these from a hand-typed sub-line —
 * inside one category both kinds sit side by side, so the row has to say which
 * it is without being expanded.
 *
 * Shared by the plan rows and by the sub-lines that stand for one, which is the
 * whole point: a bill absorbed into a category's breakdown must not start
 * describing itself differently from the plan sitting next to it.
 */
export function PlanMeta({
  frequency,
  next,
}: {
  frequency: string;
  next: string | null;
}) {
  const { t, formatDayMonth } = useI18n();
  const soon = next ? relativeDay(t, next) : null;

  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Repeat className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {FREQ_LABEL_KEYS[frequency] ? t(FREQ_LABEL_KEYS[frequency]) : frequency}
        {next && (
          <>
            {` · ${t("recurring.next")} `}
            <span className="text-foreground/70">{formatDayMonth(next)}</span>
            {soon && <span className="hidden sm:inline"> ({soon})</span>}
          </>
        )}
      </span>
    </div>
  );
}
