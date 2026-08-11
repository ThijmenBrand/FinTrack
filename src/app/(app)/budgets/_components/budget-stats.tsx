"use client";

import type { YearlyBudgetView } from "@/types/api";
import { MONTHS_PER_YEAR } from "@/lib/financial-year";
import { useI18n } from "@/lib/i18n/client";

/**
 * Four numbers, in the order the question gets asked: what may I spend, what
 * did I spend, what is left, what is already claimed by bills.
 */
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">{children}</dl>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1.5 text-xl font-semibold tabular-nums ${tone}`}>
        {value}
      </dd>
      {sub && <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

const NEGATIVE = "text-red-600 dark:text-red-400";

/**
 * The month at a glance. `toSpend` is this month's allowance — a flat limit for
 * a monthly plan, the carry-over-adjusted one for a yearly plan.
 */
export function MonthStats({
  toSpend,
  spent,
  daysLeft,
  fixedDue,
  fixedPayments,
  categories,
  allowanceNote,
}: {
  toSpend: number;
  spent: number;
  /** Null for past months — no countdown to give. */
  daysLeft: number | null;
  fixedDue: number;
  fixedPayments: number;
  categories: number;
  /** Yearly plans: where the allowance came from. */
  allowanceNote?: string;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const left = toSpend - spent;
  const perDay = daysLeft && daysLeft > 0 ? Math.max(0, left) / daysLeft : null;

  return (
    <Grid>
      <Stat
        label={t("budgets.yearly.stat.thisMonth")}
        value={formatCurrency(toSpend)}
        sub={
          allowanceNote ??
          plural(categories, "budgets.stat.categories.one", "budgets.stat.categories.other")
        }
      />
      <Stat
        label={t("budgets.stat.spentSoFar")}
        value={formatCurrency(spent)}
        sub={
          toSpend > 0
            ? t("budgets.stat.pctOfBudget", {
                pct: Math.round((spent / toSpend) * 100),
              })
            : undefined
        }
      />
      <Stat
        label={t("budgets.stat.leftThisMonth")}
        value={formatCurrency(left)}
        tone={left < 0 ? NEGATIVE : ""}
        sub={
          perDay !== null
            ? t("budgets.stat.perDayLeft", {
                amount: formatCurrency(perDay),
                days: daysLeft as number,
              })
            : undefined
        }
      />
      <Stat
        label={t("budgets.stat.fixedDue")}
        value={formatCurrency(fixedDue)}
        sub={plural(
          fixedPayments,
          "budgets.stat.recurringPayments.one",
          "budgets.stat.recurringPayments.other",
        )}
      />
    </Grid>
  );
}

/** The same four questions asked of the whole financial year. */
export function YearStats({
  view,
  isLiveYear,
}: {
  view: YearlyBudgetView;
  /** False for a year that is already over — it has no months left to run. */
  isLiveYear: boolean;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const { totals, income } = view;
  // The current month counts as remaining — it is not spent yet. A finished
  // year has none: `monthIndex` there is just the last month we can show.
  const monthsLeft = isLiveYear ? MONTHS_PER_YEAR - view.monthIndex : 0;

  return (
    <Grid>
      <Stat
        label={t("budgets.yearly.stat.income")}
        value={formatCurrency(income.total)}
        sub={
          income.monthsProjected > 0
            ? t("budgets.yearly.stat.incomeNote", {
                months: income.monthsProjected,
              })
            : undefined
        }
      />
      <Stat
        label={t("budgets.yearly.stat.pot")}
        value={formatCurrency(totals.annualPot)}
        sub={plural(
          view.categories.length,
          "budgets.stat.categories.one",
          "budgets.stat.categories.other",
        )}
      />
      <Stat
        label={t("budgets.yearly.stat.spentYear")}
        value={formatCurrency(totals.spentYear)}
        sub={
          totals.annualPot > 0
            ? t("budgets.stat.pctOfPot", {
                pct: Math.round((totals.spentYear / totals.annualPot) * 100),
              })
            : undefined
        }
      />
      <Stat
        label={t("budgets.yearly.stat.leftYear")}
        value={formatCurrency(totals.remainingYear)}
        tone={totals.remainingYear < 0 ? NEGATIVE : ""}
        sub={plural(
          monthsLeft,
          "budgets.stat.monthsRemaining.one",
          "budgets.stat.monthsRemaining.other",
        )}
      />
    </Grid>
  );
}
