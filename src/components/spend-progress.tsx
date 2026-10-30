"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { TONE } from "@/app/(app)/budgets/_components/budget-row";
import { MONEY_EPSILON } from "@/lib/validation";
import type { PotSpendStatus } from "@/types/api";

const SIZES = {
  card: {
    header: "flex items-end justify-between gap-2",
    amount: "text-lg font-bold tabular-nums leading-none",
    amountSub: "text-xs font-normal text-muted-foreground",
    badge: "text-[10px] px-1.5 py-0 font-normal",
    bar: "h-1.5",
  },
  detail: {
    header: "flex items-end justify-between gap-3 flex-wrap",
    amount: "text-3xl font-bold tabular-nums leading-none",
    amountSub: "text-lg font-normal text-muted-foreground",
    badge: "text-xs px-2 py-0.5 font-medium",
    bar: "h-2.5",
  },
} as const;

interface SpendProgressProps {
  spent: number;
  total: number;
  status: PotSpendStatus;
  categoryColor: string | null;
  size: "card" | "detail";
  meta?: ReactNode;
}

/**
 * Spent-of-budget header, left/over badge and bar — the spending counterpart
 * of SpikeProgress, shared by the pot card, the pot dialog and the dashboard.
 */
export function SpendProgress({ spent, total, status, categoryColor, size, meta }: SpendProgressProps) {
  const { t, formatCurrency: fc } = useI18n();
  const s = SIZES[size];
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : spent > 0 ? 100 : 0;
  const over = spent - total > MONEY_EPSILON;

  return (
    <div className="space-y-2">
      <div className={s.header}>
        <p className={s.amount}>
          {fc(spent)} <span className={s.amountSub}>/ {fc(total)}</span>
        </p>
        <Badge
          variant="outline"
          className={cn(s.badge, status === "ok" ? "text-muted-foreground" : TONE[status].badge)}
        >
          {over
            ? t("pots.spend.over", { amount: fc(spent - total) })
            : t("pots.spend.left", { amount: fc(total - spent) })}
        </Badge>
      </div>
      <div
        className={`${s.bar} bg-muted rounded-full overflow-hidden`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("pots.spend.aria", { spent: fc(spent), total: fc(total) })}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: status === "ok" ? categoryColor || "var(--color-primary)" : TONE[status].bar,
          }}
        />
      </div>
      {meta}
    </div>
  );
}
