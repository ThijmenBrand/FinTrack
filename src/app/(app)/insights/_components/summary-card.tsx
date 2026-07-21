"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface SummaryCardProps {
  type: "income" | "expense";
  amount: number;
  subtitle?: string;
  /** Current minus previous period. Null/undefined hides the delta line. */
  delta?: number | null;
  /** e.g. "vs last month" — rendered after the delta amount. */
  deltaLabel?: string;
  onClick: () => void;
}

const CONFIG = {
  income: {
    label: "Income",
    Icon: TrendingUp,
    iconClass: "text-emerald-500 dark:text-emerald-400",
    amountClass: "text-emerald-600 dark:text-emerald-400",
  },
  expense: {
    label: "Expenses",
    Icon: TrendingDown,
    iconClass: "text-red-500 dark:text-red-400",
    amountClass: "text-red-600 dark:text-red-400",
  },
} as const;

// Small "▲ €123 vs last month" line under a summary amount. `upIsGood`:
// income/net up = emerald; expenses up = red. Near-zero deltas render as
// "≈ same as …" in plain muted.
export function DeltaLine({
  delta,
  label,
  upIsGood,
}: {
  delta: number;
  label: string;
  upIsGood: boolean;
}) {
  if (Math.abs(delta) < 0.5) {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        ≈ same as {label.replace(/^vs /, "")}
      </p>
    );
  }
  const up = delta > 0;
  const good = up === upIsGood;
  return (
    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
      <span
        className={
          good
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        }
      >
        {up ? "▲" : "▼"} {formatCurrency(Math.abs(delta))}
      </span>{" "}
      {label}
    </p>
  );
}

// Shared Income/Expenses summary card — the two only ever differed by type/color.
export function SummaryCard({
  type,
  amount,
  subtitle,
  delta,
  deltaLabel,
  onClick,
}: SummaryCardProps) {
  const { label, Icon, iconClass, amountClass } = CONFIG[type];
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${amountClass}`}>
          {formatCurrency(amount)}
        </div>
        {delta != null && deltaLabel && (
          <DeltaLine delta={delta} label={deltaLabel} upIsGood={type === "income"} />
        )}
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
