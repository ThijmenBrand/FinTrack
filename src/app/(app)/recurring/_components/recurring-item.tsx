"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { ChevronDown, Loader2, Pause, Pencil, Play } from "lucide-react";
import { toMonthly } from "@/lib/recurring";
import type { RecurringTx } from "@/types/api";
import { relativeDay } from "./dates";
import type { SectionKey } from "./recurring-list";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
// The state palette, shared with the budgets page so "money in" and "money out"
// are one pair of colours across the app.
import { TONE_TEXT } from "@/app/(app)/budgets/_components/budget-row";

/**
 * The whole row is the disclosure trigger, so the grid sits on the button. The
 * account tag's track only exists from `sm` up: a `hidden` cell would still
 * cost the row its gap, and auto-placement would then shift the chevron.
 */
const ROW_GRID =
  "grid w-full grid-cols-[0.5rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50 sm:grid-cols-[0.5rem_minmax(0,1fr)_auto_auto_1rem]";

const DT = "text-[10px] uppercase tracking-[0.08em] text-muted-foreground";

export const FREQ_LABEL_KEYS: Record<string, MessageKey> = {
  weekly: "recurring.freq.weekly",
  biweekly: "recurring.freq.biweekly",
  monthly: "recurring.freq.monthly",
  yearly: "recurring.freq.yearly",
};

export function RecurringItem({
  item,
  kind,
  showAccount,
  expanded,
  onExpand,
  onEdit,
  onDelete,
  onToggle,
  deleting,
  toggling,
}: {
  item: RecurringTx;
  /** Which section the row sits in — a transfer is neither in nor out. */
  kind: SectionKey;
  /** Off when every plan is on the same account — the column says nothing then. */
  showAccount: boolean;
  expanded: boolean;
  onExpand: () => void;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
  /** This row's delete / pause is in flight — the whole action strip waits. */
  deleting?: boolean;
  toggling?: boolean;
}) {
  const { t, formatCurrency, formatDate, formatDayMonth } = useI18n();
  const incoming = item.type === "income";
  const monthly = toMonthly(item.amount, item.frequency);
  const soon = item.nextOccurrence ? relativeDay(t, item.nextOccurrence) : null;
  const freq = FREQ_LABEL_KEYS[item.frequency]
    ? t(FREQ_LABEL_KEYS[item.frequency])
    : item.frequency;
  // A transfer's amount is real money moving, but it is neither earned nor
  // spent — so it keeps the sign that says which way and drops the colour that
  // would claim it counted.
  const tone =
    kind === "transfer"
      ? "text-muted-foreground"
      : incoming
        ? TONE_TEXT.positive
        : TONE_TEXT.negative;

  return (
    <li>
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={expanded}
        className={`${ROW_GRID} ${item.isActive ? "" : "opacity-60"}`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: item.categoryColor || (incoming ? "#10b981" : "#94a3b8") }}
        />

        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{item.description}</span>
            {!item.isActive && (
              <span className="shrink-0 rounded border px-2 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("recurring.paused")}
              </span>
            )}
          </span>
          {/* Frequency and next date first: on a phone the line has room for
              little else, and the trailing detail is what can safely truncate. */}
          <span className="block truncate text-xs text-muted-foreground">
            {freq}
            {item.nextOccurrence && (
              <>
                {` · ${t("recurring.next")} ${formatDayMonth(item.nextOccurrence)}`}
                {soon && ` (${soon})`}
              </>
            )}
            {item.categoryName && ` · ${item.categoryName}`}
          </span>
        </span>

        {/* Which account gets debited: the detail that decides whether a plan is
            affordable, so it keeps its own column rather than trailing the meta
            line where it was the first thing to truncate. */}
        {showAccount && item.accountName && (
          <span className="hidden max-w-[9rem] truncate rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:block">
            {item.accountName}
          </span>
        )}

        <span className="text-right text-sm tabular-nums">
          <span className={`block whitespace-nowrap font-medium ${tone}`}>
            {incoming ? "+" : "−"}
            {formatCurrency(Math.abs(item.amount))}
          </span>
          {/* Non-monthly plans get their monthly equivalent, so the row
              reconciles with the monthly total in the section header above it. */}
          {item.frequency !== "monthly" && (
            <span className="block whitespace-nowrap text-xs text-muted-foreground">
              ≈ {formatCurrency(monthly)}
              {t("recurring.perMonthShort")}
            </span>
          )}
        </span>

        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="mb-3 ml-2 mr-2 rounded-lg border bg-card p-4 sm:ml-7">
          <dl className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
            <div>
              <dt className={DT}>{t("recurring.form.frequency")}</dt>
              <dd className="text-[13px]">{freq}</dd>
            </div>
            <div>
              <dt className={DT}>{t("recurring.nextPayment")}</dt>
              <dd className="text-[13px]">
                {item.nextOccurrence
                  ? `${formatDate(item.nextOccurrence)}${soon ? ` (${soon})` : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className={DT}>{t("common.account")}</dt>
              <dd className="truncate text-[13px]">{item.accountName || "—"}</dd>
            </div>
            <div>
              <dt className={DT}>{t("common.category")}</dt>
              <dd className="truncate text-[13px]">
                {item.categoryName || t("categorySelect.none")}
              </dd>
            </div>
          </dl>
          {/* Full contrast even on a paused row — pausing must not dim the
              control that undoes it. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggle(item)}
              disabled={toggling || deleting}
            >
              {toggling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : item.isActive ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {item.isActive ? t("recurring.pause") : t("recurring.resume")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(item)}
              disabled={toggling || deleting}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("common.edit")}
            </Button>
            <ConfirmDeleteButton
              variant="text"
              className="ml-auto"
              pending={deleting}
              disabled={toggling}
              onConfirm={() => onDelete(item.id)}
              label={t("common.delete")}
              message={t("recurring.deleteLabel", { name: item.description })}
            />
          </div>
        </div>
      )}
    </li>
  );
}
