"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";

// Small "▲ €123 vs last month" line under a stat. `upIsGood`: income/net up =
// emerald, expenses up = red. Near-zero deltas render as "≈ same as …".
function DeltaLine({
  delta,
  label,
  upIsGood,
}: {
  delta: number;
  label: string;
  upIsGood: boolean;
}) {
  const { t, formatCurrency } = useI18n();
  if (Math.abs(delta) < 0.5) {
    return (
      <span className="text-muted-foreground">
        {t("insights.stat.sameAs", { label })}
      </span>
    );
  }
  const up = delta > 0;
  const good = up === upIsGood;
  return (
    <>
      <span
        className={
          good
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        }
      >
        {up ? "▲" : "▼"} {formatCurrency(Math.abs(delta))}
      </span>
      {/* Phones say what the arrows compare once, under the card. */}
      <span className="text-muted-foreground max-md:hidden"> {label}</span>
    </>
  );
}

// Phones lay the strip out as two tiers on a six-column grid: income and
// expenses large, half the width each, then net, savings rate and pace small
// in thirds under a rule. Five equal cells left one orphaned on its own row.
const PRIMARY = "max-md:col-span-3";
const SECONDARY = "max-md:col-span-2";

function Stat({
  label,
  value,
  valueClass,
  sub,
  onClick,
  primary = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`truncate whitespace-nowrap font-semibold tabular-nums md:text-lg ${
          primary ? "text-2xl max-md:tracking-tight" : "text-[15px]"
        } ${valueClass ?? ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight tabular-nums">{sub}</div>
    </>
  );
  const span = primary ? PRIMARY : SECONDARY;
  if (!onClick) return <div className={`min-w-0 ${span}`}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 rounded-md -m-1 p-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60 ${span}`}
    >
      {body}
    </button>
  );
}

interface StatStripProps {
  income: number;
  expenses: number;
  net: number;
  txCount: number;
  /** Deltas vs the previous period; null hides the comparison lines. */
  previous: { totalIncome: number; totalExpenses: number; net: number } | null;
  deltaLabel: string | null;
  /** Days of the range that have already elapsed — the pace denominator. */
  elapsedDays: number;
  onIncomeClick: () => void;
  onExpensesClick: () => void;
}

/**
 * One dense row of headline numbers, replacing the old three summary cards.
 * Savings rate and weekly pace come free from the same totals and are the two
 * numbers you'd otherwise work out in your head.
 */
export function StatStrip({
  income,
  expenses,
  net,
  txCount,
  previous,
  deltaLabel,
  elapsedDays,
  onIncomeClick,
  onExpensesClick,
}: StatStripProps) {
  const { t, formatCurrency } = useI18n();
  const showDeltas = previous !== null && deltaLabel !== null;
  const savingsRate = income > 0 ? (net / income) * 100 : null;
  const perWeek = elapsedDays > 0 ? (expenses / elapsedDays) * 7 : null;

  return (
    <Card>
      <CardContent className="grid grid-cols-6 items-start gap-x-4 gap-y-3 py-4 md:grid-cols-5 md:gap-x-6 md:gap-y-5">
        <Stat
          primary
          label={t("insights.stat.income")}
          value={formatCurrency(income)}
          onClick={onIncomeClick}
          sub={
            showDeltas ? (
              <>
                <DeltaLine
                  delta={income - previous.totalIncome}
                  label={deltaLabel}
                  upIsGood
                />
                <span className="text-muted-foreground">
                  {" · "}
                  {t("insights.stat.txCount", { count: txCount })}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {t("insights.stat.txCount", { count: txCount })}
              </span>
            )
          }
        />
        <Stat
          primary
          label={t("insights.stat.expenses")}
          value={formatCurrency(expenses)}
          onClick={onExpensesClick}
          sub={
            showDeltas && (
              <DeltaLine
                delta={expenses - previous.totalExpenses}
                label={deltaLabel}
                upIsGood={false}
              />
            )
          }
        />
        <div className="col-span-6 border-t md:hidden" aria-hidden="true" />
        <Stat
          label={t("insights.stat.net")}
          value={`${net >= 0 ? "+" : ""}${formatCurrency(net)}`}
          valueClass={
            net >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }
          sub={
            showDeltas && (
              <DeltaLine
                delta={net - previous.net}
                label={deltaLabel}
                upIsGood
              />
            )
          }
        />
        <Stat
          label={t("insights.stat.savingsRate")}
          value={savingsRate === null ? "—" : `${savingsRate.toFixed(1)}%`}
          sub={
            <span className="text-muted-foreground">
              {savingsRate === null
                ? t("insights.stat.noIncome")
                : t("insights.stat.ofIncomeKept")}
            </span>
          }
        />
        <Stat
          label={t("insights.stat.avgPerWeek")}
          value={perWeek === null ? "—" : formatCurrency(perWeek)}
          sub={<span className="text-muted-foreground">{t("insights.stat.spendingPace")}</span>}
        />
        {showDeltas && (
          <p className="col-span-6 -mt-1 text-[11px] text-muted-foreground md:hidden">
            {t("insights.stat.deltaCaption", { label: deltaLabel })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
