"use client";

import { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PotCategory, PotDetails } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

const SHOWN = 20;

/**
 * The pot's transactions, newest first. With a budget planned, each one says
 * which line it counts toward — moving it means changing its category (or
 * the pot category under it).
 */
export function TransactionsTab({
  data,
  potCategories,
}: {
  data: PotDetails;
  potCategories: Map<string, PotCategory>;
}) {
  const { t, formatCurrency: fc, formatDate } = useI18n();
  const { pot, transactions, budget } = data;
  const hasLines = budget.lines.length > 0;

  // Category (or pot category) → the line it counts toward, as "Line" or
  // "Parent › Sub-line". A pot category's line wins over its parent's — the
  // same order the server attributes spend in (lineForSpend).
  const lineOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of budget.lines) {
      for (const c of [...l.categoryIds, ...l.potCategoryIds]) map.set(c, l.name);
      for (const child of l.children) {
        for (const c of [...child.categoryIds, ...child.potCategoryIds]) map.set(c, `${l.name} › ${child.name}`);
      }
    }
    return map;
  }, [budget.lines]);

  if (transactions.length === 0) {
    return <p className="py-6 text-center text-sm italic text-muted-foreground">{t("pots.detail.noLinked")}</p>;
  }

  return (
    <div className="space-y-2">
      {hasLines && <p className="text-xs text-muted-foreground">{t("pots.tx.hint")}</p>}
      <ul className="divide-y rounded-lg border">
        {transactions.slice(0, SHOWN).map((tx) => {
          const line =
            (tx.potCategoryId ? lineOf.get(tx.potCategoryId) : undefined) ??
            (tx.categoryId ? lineOf.get(tx.categoryId) : undefined);
          const potCategory = tx.potCategoryId ? potCategories.get(tx.potCategoryId) : undefined;
          const label =
            tx.type === "internal_transfer" ? t("pots.tx.transfer") : line ?? t("pots.budget.unplanned");
          return (
            <li key={tx.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{tx.description}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDate(tx.date)}
                  {tx.categoryName && (
                    <>
                      {" · "}
                      <span style={{ color: tx.categoryColor || undefined }}>{tx.categoryName}</span>
                      {potCategory && ` › ${potCategory.name}`}
                    </>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "tabular-nums",
                    tx.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                  )}
                >
                  {tx.amount >= 0 ? "+" : ""}
                  {fc(tx.amount)}
                </p>
                {hasLines && (
                  <p className={cn("max-w-[9rem] truncate text-[11px]", line ? "text-foreground/70" : "text-muted-foreground italic")}>
                    {label}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-1 text-xs text-muted-foreground">
        {transactions.length > SHOWN && `${t("pots.detail.showingOf", { total: transactions.length })} `}
        <Link href={`/transactions?pot=${pot.id}`} className="text-primary hover:underline">
          {t("pots.detail.viewFullList")}
        </Link>
        .
      </p>
    </div>
  );
}
