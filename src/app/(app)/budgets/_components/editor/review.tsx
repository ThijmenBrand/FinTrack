"use client";

import { ArrowRight, Check, CheckCheck, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { REVIEW_TONE, type ReviewTone } from "./review-tone";

/**
 * A suggestion still waiting for an answer, under the row it would change.
 *
 * Every pending suggestion gets this same panel in the same place — under the
 * name, answers on the right — whether it changes a line or adds one, so a
 * long review is one motion repeated down the page rather than a hunt for
 * where each row put its buttons. The panel carries the suggested number; the
 * field above it keeps the current one, so the two are read side by side.
 */
export function PendingSuggestion({
  tone,
  name,
  from,
  to,
  unit,
  basis,
  blocked,
  onAccept,
  onDecline,
}: {
  tone: ReviewTone;
  name: string;
  /** Display units. Absent when the suggestion adds the line. */
  from?: number;
  to: number;
  unit: string;
  /** What the number comes from: the stretch of spending it was read off. */
  basis: string;
  /**
   * Why it can't be taken as-is, when it can't — a total set by its lines.
   * The panel still shows the number; only Decline is offered.
   */
  blocked?: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  const look = REVIEW_TONE[tone];
  const delta = from === undefined ? null : to - from;

  return (
    <div
      role="group"
      aria-label={t("budgets.review.suggestionFor", { name })}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 ${look.panel}`}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${look.text}`}>
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {t(from === undefined ? "budgets.review.suggestedNew" : "budgets.review.suggested")}
        </span>
        <span className="whitespace-nowrap text-sm tabular-nums">
          {from !== undefined && (
            <>
              <del className="text-muted-foreground">{formatCurrency(from)}</del>
              <ArrowRight
                className="mx-1.5 inline h-3 w-3 align-[-1px] text-muted-foreground"
                aria-label={t("budgets.review.becomes")}
              />
            </>
          )}
          <ins className={`font-semibold no-underline ${look.text}`}>
            {formatCurrency(to)}
          </ins>
          <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>
        </span>
        {delta !== null && Math.abs(delta) >= 0.01 && (
          <span
            className={`rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums ${look.chip}`}
          >
            {delta > 0 ? "+" : "−"}
            {formatCurrency(Math.abs(delta))}
          </span>
        )}
        <span className="min-w-0 text-xs text-muted-foreground">{blocked ?? basis}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-muted-foreground hover:text-foreground"
          onClick={onDecline}
          aria-label={t("budgets.review.declineFor", { name })}
        >
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {t("budgets.review.decline")}
        </Button>
        {!blocked && (
          <Button
            size="sm"
            className="h-8 px-2.5"
            onClick={onAccept}
            aria-label={t("budgets.review.acceptFor", { name })}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("budgets.review.accept")}
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * A suggestion taken into the draft. The row has the new figure now, so this
 * keeps the difference on screen until Save — what it was, what it is — and
 * one click puts it back up for review.
 */
export function AcceptedSuggestion({
  tone,
  from,
  to,
  onUndo,
}: {
  tone: ReviewTone;
  /** Display units. Absent on a line the suggestion added. */
  from?: number;
  to: number;
  onUndo: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  const look = REVIEW_TONE[tone];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <Check className={`h-3.5 w-3.5 ${look.text}`} aria-hidden="true" />
      <span className={look.text}>
        {t(from === undefined ? "budgets.review.added" : "budgets.review.accepted")}
      </span>
      {from !== undefined && from !== to && (
        <span className="tabular-nums">
          <del>{formatCurrency(from)}</del>
          {" → "}
          {formatCurrency(to)}
        </span>
      )}
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        onClick={onUndo}
        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" aria-hidden="true" />
        {t("budgets.editor.undo")}
      </button>
    </div>
  );
}

/** Where the field goes on a line that only exists as a suggestion. */
export function NewChip() {
  const { t } = useI18n();
  return (
    <span
      className={`flex h-9 min-w-28 items-center justify-center rounded-md border border-dashed border-emerald-500/50 px-2.5 text-xs font-semibold uppercase tracking-wide sm:min-w-32 ${REVIEW_TONE.added.text}`}
    >
      + {t("budgets.review.new")}
    </span>
  );
}

/**
 * The head of a review: how many suggestions, what kind, what taking them all
 * would do to the plan, and the two answers for all of them at once.
 *
 * Sticky, because the rows it is about run the length of the page and the
 * "accept all" a user reaches for after reading the third one should not be
 * three screens back up.
 */
export function ReviewBar({
  generating,
  lookbackMonths,
  changed,
  added,
  net,
  unit,
  onAcceptAll,
  onDeclineAll,
}: {
  generating: boolean;
  lookbackMonths: number;
  /** Pending counts, by tone. */
  changed: number;
  added: number;
  /** What accepting every pending one moves the allocated total by, in display units. */
  net: number;
  unit: string;
  /** Absent when no pending suggestion can be taken as-is (all set by their lines). */
  onAcceptAll?: () => void;
  onDeclineAll: () => void;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const count = changed + added;

  return (
    <div
      role="region"
      aria-label={t("budgets.review.region")}
      aria-busy={generating}
      className="sticky top-2 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" aria-live="polite">
          {generating
            ? plural(lookbackMonths, "budgets.review.generating.one", "budgets.review.generating.other")
            : plural(count, "budgets.review.title.one", "budgets.review.title.other")}
        </p>
        {!generating && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {plural(lookbackMonths, "budgets.review.basis.one", "budgets.review.basis.other")}
            </span>
            {changed > 0 && (
              <Legend tone="changed">
                {plural(changed, "budgets.review.changed.one", "budgets.review.changed.other")}
              </Legend>
            )}
            {added > 0 && (
              <Legend tone="added">
                {plural(added, "budgets.review.addedCount.one", "budgets.review.addedCount.other")}
              </Legend>
            )}
            {Math.abs(net) >= 0.01 && (
              <span className="tabular-nums">
                {t("budgets.review.net", {
                  amount: `${net > 0 ? "+" : "−"}${formatCurrency(Math.abs(net))}`,
                  unit,
                })}
              </span>
            )}
          </p>
        )}
      </div>
      {!generating && count > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8" onClick={onDeclineAll}>
            {t("budgets.review.declineAll")}
          </Button>
          {onAcceptAll && (
            <Button size="sm" className="h-8" onClick={onAcceptAll}>
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("budgets.review.acceptAll")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ tone, children }: { tone: ReviewTone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-0.5 rounded-full ${REVIEW_TONE[tone].swatch}`} aria-hidden="true" />
      {children}
    </span>
  );
}
