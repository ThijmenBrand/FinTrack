"use client";

import { useI18n } from "@/lib/i18n/client";

interface PlainAmountProps {
  netAmount: number;
  transactionCount: number;
  size: "card" | "detail";
}

/** Net-amount + transaction-count block for a non-spike pot, at card or detail scale. */
export function PlainAmount({ netAmount, transactionCount, size }: PlainAmountProps) {
  const { plural, formatCurrency: fc } = useI18n();
  const amountSize = size === "detail" ? "text-3xl" : "text-lg";
  const color =
    netAmount === 0
      ? "text-foreground"
      : netAmount > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div>
      <p className={`${amountSize} font-bold tabular-nums leading-none ${color}`}>
        {netAmount >= 0 ? "+" : ""}
        {fc(netAmount)}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {size === "detail"
          ? plural(transactionCount, "pots.plainCountGrouped.one", "pots.plainCountGrouped.other")
          : plural(transactionCount, "pots.plainCount.one", "pots.plainCount.other")}
      </p>
    </div>
  );
}
