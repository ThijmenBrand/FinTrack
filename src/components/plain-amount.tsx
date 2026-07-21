"use client";

import { formatCurrency as fc } from "@/lib/utils";

interface PlainAmountProps {
  netAmount: number;
  transactionCount: number;
  size: "card" | "detail";
}

/** Net-amount + transaction-count block for a non-spike pot, at card or detail scale. */
export function PlainAmount({ netAmount, transactionCount, size }: PlainAmountProps) {
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
        {transactionCount} transaction{transactionCount === 1 ? "" : "s"}
        {size === "detail" ? " grouped" : ""}
      </p>
    </div>
  );
}
