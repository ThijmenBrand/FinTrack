"use client";

import type { ForecastData } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { TONE_TEXT } from "@/app/(app)/budgets/_components/budget-row";

/**
 * The schedule as one scrollable strip above the list rather than a column
 * beside it: it is read once, in date order, and a full-height card of it
 * competed with the plans people came here to edit.
 */
export function UpcomingPayments({ payments }: { payments: ForecastData["upcomingPayments"] }) {
  const { plural, formatCurrency, formatDayMonth } = useI18n();
  // Nothing scheduled is not worth a card of its own — the list below already
  // says whether there are plans at all.
  if (payments.length === 0) return null;

  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-[11px] text-muted-foreground">
        {plural(payments.length, "recurring.upcomingNext.one", "recurring.upcomingNext.other")}
      </h2>
      {/* Negative margin + padding so a card's focus ring and shadow aren't
          clipped by the scroll container's own edge. */}
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
        {payments.map((p, i) => {
          const incoming = p.type === "income";
          const tone =
            p.type === "transfer"
              ? "text-muted-foreground"
              : incoming
                ? TONE_TEXT.positive
                : TONE_TEXT.negative;
          return (
            <li
              key={i}
              className="w-32 shrink-0 snap-start rounded-md border bg-card px-3 py-2"
            >
              <div className="text-[11px] text-muted-foreground">{formatDayMonth(p.date)}</div>
              <div className="truncate text-[13px]" title={p.description}>
                {p.description}
              </div>
              <div className={`text-[13px] tabular-nums ${tone}`}>
                {incoming ? "+" : "−"}
                {formatCurrency(Math.abs(p.amount))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
