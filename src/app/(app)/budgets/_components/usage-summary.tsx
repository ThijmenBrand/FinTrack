"use client";

import { usageTone } from "./budget-row";
import { useI18n } from "@/lib/i18n/client";

/** Card-level total: spent of planned, with what's left underneath. */
export function UsageTotal({
  spent,
  limit,
  remainingLabel,
}: {
  spent: number;
  limit: number;
  /** Word after the remaining amount — "left" for budgets, "due" for fixed costs. */
  remainingLabel?: string;
}) {
  const { t, formatCurrency } = useI18n();
  const over = spent > limit;
  return (
    // ml-auto keeps it hugging the right edge when it wraps onto its own line.
    <div className="ml-auto shrink-0 text-right tabular-nums">
      <div className="whitespace-nowrap text-xl font-semibold leading-none">
        {formatCurrency(spent)}
        <span className="text-sm font-normal text-muted-foreground">
          {" / "}
          {formatCurrency(limit)}
        </span>
      </div>
      <div className={`mt-1.5 text-xs ${usageTone(spent, limit).text}`}>
        {over
          ? t("budgets.row.overAmount", { amount: formatCurrency(spent - limit) })
          : t("budgets.usage.remaining", {
              amount: formatCurrency(limit - spent),
              label: remainingLabel ?? t("budgets.usage.left"),
            })}
      </div>
    </div>
  );
}

/** The aggregate bar that caps a card's list of per-row bars. */
export function UsageBar({ spent, limit }: { spent: number; limit: number }) {
  const { t } = useI18n();
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  return (
    // Padding, not margin — the card header's space-y would fight a margin here.
    <div className="pt-2.5">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(limit)}
        aria-valuenow={Math.round(spent)}
        aria-label={t("budgets.usage.totalLabel")}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${usageTone(spent, limit).bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
