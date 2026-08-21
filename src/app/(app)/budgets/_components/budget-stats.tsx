"use client";

import type { YearlyBudgetView } from "@/types/api";
import { MONTHS_PER_YEAR } from "@/lib/financial-year";
import { useI18n } from "@/lib/i18n/client";
import { TONE_TEXT } from "./budget-row";

/**
 * Four numbers, in the order money actually moves: what came in, what it is
 * committed to, what has gone, what is still free.
 *
 * Tablet and up only — see `Meter` for the phone.
 */
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="hidden gap-x-6 gap-y-5 sm:grid sm:grid-cols-4">{children}</dl>
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
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-2xl font-semibold leading-none tabular-nums lg:text-[1.75rem] ${tone}`}
      >
        {value}
      </dd>
      {sub && <dd className="mt-1.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

const NEGATIVE = TONE_TEXT.negative;
/**
 * The one figure the page is opened for gets the accent. Everything else in
 * the strip stays foreground — four coloured numbers is no emphasis at all.
 */
const HEADLINE = "text-primary";

/**
 * The phone's version of the strip above.
 *
 * Four numbers side by side leave about 150px each at 360px and push the
 * categories a full screen down — on a phone the plan itself is what the page
 * is for. So the phone answers the one question a budget gets opened for
 * (what is left), draws the rest as a bar, and puts the supporting figures on
 * one line under it.
 */
function Meter({
  label,
  value,
  negative,
  aside,
  usedPct,
  reservedPct = 0,
  barLabel,
  facts,
}: {
  label: string;
  value: string;
  negative?: boolean;
  /** Counter beside the label — the daily pace, or months still to run. */
  aside?: string;
  usedPct: number;
  /** Second segment: money still owed to bills that have not gone out yet. */
  reservedPct?: number;
  barLabel: string;
  facts: (string | false | undefined)[];
}) {
  return (
    <div className="sm:hidden">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {aside && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {aside}
          </span>
        )}
      </div>
      <p
        className={`mt-1 text-3xl font-semibold leading-tight tabular-nums ${negative ? NEGATIVE : ""}`}
      >
        {value}
      </p>
      {/* Spent, then what the bills will still take, then the free remainder.
          One bar says what the middle two stats used to say in words. */}
      <div
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={barLabel}
      >
        <div
          className={`h-full transition-[width] duration-500 ${negative ? "bg-red-500" : "bg-primary"}`}
          style={{ width: `${usedPct}%` }}
        />
        {reservedPct > 0 && (
          <div
            className="h-full bg-primary/25 transition-[width] duration-500"
            style={{ width: `${reservedPct}%` }}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {facts.filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/** Share of `total`, clamped to the bar. */
const share = (part: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, (part / total) * 100)) : 0;

/**
 * The month at a glance. `toSpend` is everything the month is budgeted to
 * cost — the allocations (a flat limit for a monthly plan, the
 * carry-over-adjusted one for a yearly plan) plus the fixed costs — and
 * `spent` is measured on the same footing.
 */
export function MonthStats({
  toSpend,
  spent,
  daysLeft,
  fixedDue,
  fixedPayments,
  categories,
  allowanceNote,
  incomeReceived,
  incomeExpected,
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
  /** What the period's recurring income has actually brought in, and promised. */
  incomeReceived: number;
  incomeExpected: number;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const left = toSpend - spent;
  // `toSpend` includes the fixed costs, so part of what is left is already
  // owed to bills that have not gone out yet. The daily pace is what survives
  // them — otherwise it invites you to spend the rent.
  const perDay =
    daysLeft && daysLeft > 0 ? Math.max(0, left - fixedDue) / daysLeft : null;
  const spentLine = t("budgets.allocationsSpent", {
    spent: formatCurrency(spent),
    limit: formatCurrency(toSpend),
  });
  const usedPct = share(spent, toSpend);

  return (
    <>
      <Meter
        label={t("budgets.stat.leftThisMonth")}
        value={formatCurrency(left)}
        negative={left < 0}
        aside={
          perDay !== null
            ? t("budgets.stat.perDayLeft", {
                amount: formatCurrency(perDay),
                days: daysLeft as number,
              })
            : undefined
        }
        usedPct={usedPct}
        reservedPct={Math.min(100 - usedPct, share(fixedDue, toSpend))}
        barLabel={spentLine}
        facts={[
          spentLine,
          fixedDue > 0 &&
            `${t("budgets.stat.fixedDue")} ${formatCurrency(fixedDue)}`,
        ]}
      />
      <Grid>
        {/* Income opens the strip: the plan below divides up this number, so
            reading it first is reading the page in the order it works. */}
        <Stat
          label={t("budgets.stat.income")}
          value={formatCurrency(incomeReceived)}
          sub={
            incomeExpected > 0
              ? t("budgets.expectedAmount", {
                  amount: formatCurrency(incomeExpected),
                })
              : undefined
          }
        />
        <Stat
          label={t("budgets.yearly.stat.thisMonth")}
          value={formatCurrency(toSpend)}
          // What is claimed before a single discretionary euro moves. It lost
          // its own tile to income and rides here instead, on the figure it is
          // a part of.
          sub={[
            allowanceNote ??
              plural(
                categories,
                "budgets.stat.categories.one",
                "budgets.stat.categories.other",
              ),
            fixedPayments > 0 &&
              t("budgets.stat.inclFixed", {
                amount: formatCurrency(fixedDue),
              }),
          ]
            .filter(Boolean)
            .join(" · ")}
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
          tone={left < 0 ? NEGATIVE : HEADLINE}
          sub={
            perDay !== null
              ? t("budgets.stat.perDayLeft", {
                  amount: formatCurrency(perDay),
                  days: daysLeft as number,
                })
              : undefined
          }
        />
      </Grid>
    </>
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
  const spentLine = t("budgets.allocationsSpent", {
    spent: formatCurrency(totals.spentYear),
    limit: formatCurrency(totals.annualPot),
  });

  return (
    <>
      <Meter
        label={t("budgets.yearly.stat.leftYear")}
        value={formatCurrency(totals.remainingYear)}
        negative={totals.remainingYear < 0}
        aside={
          monthsLeft > 0
            ? plural(
                monthsLeft,
                "budgets.stat.monthsRemaining.one",
                "budgets.stat.monthsRemaining.other",
              )
            : undefined
        }
        usedPct={share(totals.spentYear, totals.annualPot)}
        barLabel={spentLine}
        facts={[
          spentLine,
          `${t("budgets.yearly.stat.income")} ${formatCurrency(income.total)}`,
        ]}
      />
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
        tone={totals.remainingYear < 0 ? NEGATIVE : HEADLINE}
        sub={plural(
          monthsLeft,
          "budgets.stat.monthsRemaining.one",
          "budgets.stat.monthsRemaining.other",
        )}
      />
      </Grid>
    </>
  );
}
