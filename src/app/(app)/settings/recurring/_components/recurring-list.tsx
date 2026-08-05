"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { toMonthly } from "@/lib/recurring";
import type { RecurringTx } from "@/types/api";
import { RecurringItem } from "./recurring-item";

/**
 * Both types live in one card rather than two side-by-side ones: with a handful
 * of items each, two cards were mostly empty and never the same height, and a
 * collapsed one showed nothing but its own title.
 */
export function RecurringList({
  items,
  onEdit,
  onDelete,
  onToggle,
}: {
  items: RecurringTx[];
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
}) {
  const sections = (["income", "expense"] as const).map((type) => {
    const rows = items
      .filter((i) => i.type === type)
      // Paused plans sink to the bottom of their section — they don't count
      // toward the total, so they shouldn't interrupt the ones that do.
      .sort((a, b) => Number(b.isActive) - Number(a.isActive));
    const monthly = rows
      .filter((i) => i.isActive)
      .reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);
    return { type, rows, monthly };
  });

  const activeCount = items.filter((i) => i.isActive).length;
  const pausedCount = items.length - activeCount;
  const showAccount = new Set(items.map((i) => i.accountId)).size > 1;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Recurring items</CardTitle>
        <CardDescription>
          {activeCount} active
          {pausedCount > 0 ? ` · ${pausedCount} paused` : ""} · monthly totals exclude paused plans
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <ul className="divide-y overflow-hidden border-y sm:rounded-md sm:border-x">
          {sections.map(({ type, rows, monthly }) => (
            <SectionGroup key={type} type={type} monthly={monthly} count={rows.length}>
              {rows.map((item) => (
                <RecurringItem
                  key={item.id}
                  item={item}
                  showAccount={showAccount}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggle={onToggle}
                />
              ))}
            </SectionGroup>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SectionGroup({
  type,
  monthly,
  count,
  children,
}: {
  type: "income" | "expense";
  monthly: number;
  count: number;
  children: React.ReactNode;
}) {
  const isIncome = type === "income";
  const Icon = isIncome ? TrendingUp : TrendingDown;

  return (
    <>
      <li className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon
            className={`h-3.5 w-3.5 ${isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          />
          {isIncome ? "Income" : "Expenses"}
          {count > 0 && <span className="tabular-nums font-normal">({count})</span>}
        </span>
        {count > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{formatCurrency(monthly)}</span> /mo
          </span>
        )}
      </li>
      {count === 0 ? (
        <li className="px-4 py-5 text-center text-sm text-muted-foreground">
          No recurring {isIncome ? "income" : "expenses"} yet.
        </li>
      ) : (
        children
      )}
    </>
  );
}
