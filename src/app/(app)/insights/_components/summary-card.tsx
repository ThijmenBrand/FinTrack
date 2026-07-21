"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface SummaryCardProps {
  type: "income" | "expense";
  amount: number;
  subtitle?: string;
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

// Shared Income/Expenses summary card — the two only ever differed by type/color.
export function SummaryCard({ type, amount, subtitle, onClick }: SummaryCardProps) {
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
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
