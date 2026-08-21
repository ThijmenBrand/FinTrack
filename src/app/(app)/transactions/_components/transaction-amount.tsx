"use client";

import type { Transaction } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

/**
 * Amount cell — shared between layouts and by split child rows; handles
 * reimbursement strike-through and in-pot/transfer muting.
 */
export function Amount({ tx }: { tx: Transaction }) {
  const { formatCurrency } = useI18n();
  const isTransfer = tx.type === "internal_transfer";
  const isReimbursement = tx.type === "reimbursement";
  const isInPot = !!tx.groupId;
  if (tx.reimbursementCount > 0) {
    return (
      <>
        <span className="block font-mono text-sm font-medium text-red-600 dark:text-red-400">
          {formatCurrency(tx.effectiveAmount)}
        </span>
        <span className="block text-xs text-muted-foreground line-through">
          {formatCurrency(tx.amount)}
        </span>
      </>
    );
  }
  return (
    <span
      className={`font-mono text-sm font-medium ${isInPot ? "line-through " : ""}${
        isTransfer || isReimbursement || isInPot
          ? "text-muted-foreground"
          : tx.amount >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
      }`}
    >
      {tx.amount >= 0 ? "+" : ""}
      {formatCurrency(tx.amount)}
    </span>
  );
}
