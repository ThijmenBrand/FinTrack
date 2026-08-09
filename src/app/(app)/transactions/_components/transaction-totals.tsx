"use client";

import { TrendingUp, TrendingDown, Equal } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

export function TransactionTotals({
  totals,
}: {
  totals: { income: number; expense: number; net: number };
}) {
  const { t, formatCurrency } = useI18n();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          {t("common.income")}
        </div>
        <p className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
          +{formatCurrency(totals.income)}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <TrendingDown className="h-4 w-4 text-red-500" />
          {t("common.expenses")}
        </div>
        <p className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">
          {formatCurrency(totals.expense)}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Equal className="h-4 w-4" />
          {t("tx.totals.netTotal")}
        </div>
        <p className={`text-xl sm:text-2xl font-bold ${
          totals.net >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        }`}>
          {totals.net >= 0 ? "+" : ""}{formatCurrency(totals.net)}
        </p>
      </div>
    </div>
  );
}
