import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getUpcomingMoney } from "../_lib/dashboard-queries";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { getI18n } from "@/lib/i18n/server";
import type { I18n } from "@/lib/i18n/translate";
import type { UpcomingMoneyEvent } from "@/types/api";
import { TONE_TEXT } from "@/app/(app)/budgets/_components/budget-row";

/**
 * How many rows the card shows before it hands off to /recurring. Enough for a
 * normal month's rent, salary and a handful of subscriptions; past that the
 * card stops being a glance.
 */
const VISIBLE_ROWS = 7;

// Date gutter, name + meta, amount. Mobile drops to two columns — the gutter
// is hidden and the date moves into the meta line, where it costs no width.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[4.75rem_minmax(0,1fr)_auto]";

/**
 * The one badge a row may carry. Only the next two days and anything already
 * due get one: a bill three weeks out needs no decoration, and colouring every
 * expense red would make an ordinary month look like an emergency.
 */
function rowBadge(
  event: UpcomingMoneyEvent,
  { t }: I18n,
): { label: string; className: string } | null {
  if (event.overdue)
    return {
      label: t("dashboard.upcoming.overdue"),
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-400",
    };
  if (event.daysUntil === 0)
    return {
      label: t("dashboard.upcoming.today"),
      className: "border-border bg-muted text-foreground",
    };
  if (event.daysUntil === 1)
    return {
      label: t("dashboard.upcoming.tomorrow"),
      className: "border-border bg-muted text-muted-foreground",
    };
  return null;
}

function EventRow({ event, i18n }: { event: UpcomingMoneyEvent; i18n: I18n }) {
  const { t, formatCurrency, formatDayMonth } = i18n;
  const badge = rowBadge(event, i18n);
  const incoming = event.type === "income";
  const date = formatDayMonth(event.date);
  const meta = [event.categoryName, event.accountName].filter(Boolean).join(" · ");

  return (
    <li className={ROW}>
      <span
        className={`hidden text-xs tabular-nums sm:block ${
          event.overdue
            ? TONE_TEXT.warning
            : event.daysUntil === 0
              ? "text-foreground"
              : "text-muted-foreground"
        }`}
      >
        {date}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {event.categoryColor && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: event.categoryColor }}
              aria-hidden="true"
            />
          )}
          <span className="truncate text-sm font-medium">{event.description}</span>
          {badge && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0 text-[10px] font-normal ${badge.className}`}
              title={
                event.overdue
                  ? t("dashboard.upcoming.overdueHint", { date })
                  : undefined
              }
            >
              {badge.label}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {/* The gutter is gone at this width, so the date rides along here. */}
          <span className="sm:hidden">{date}</span>
          {meta && <span className="sm:hidden"> · </span>}
          {meta}
        </p>
      </div>

      <span
        className={`text-sm font-semibold tabular-nums ${
          event.overdue
            ? TONE_TEXT.warning
            : incoming
              ? TONE_TEXT.positive
              : "text-foreground"
        }`}
      >
        {incoming ? "+" : "−"}
        {formatCurrency(Math.abs(event.amount))}
      </span>
    </li>
  );
}

/**
 * Upcoming bills and income: every occurrence of the user's recurring plans in
 * the next 30 days, in date order, with what it does to the month summed above
 * them. It sits under the budget card because it answers the question that
 * card raises — "is what's left enough for what's still coming?".
 */
export async function UpcomingMoneyCard({
  userId,
  startDay = 1,
  accountIds,
}: {
  userId: string;
  startDay?: number;
  /** A pinned budget's accounts; undefined means every account in view. */
  accountIds?: string[];
}) {
  const [money, i18n] = await Promise.all([
    getUpcomingMoney(userId, accountIds),
    getI18n(),
  ]);
  const { t, plural, formatCurrency, formatDayMonth } = i18n;

  const header = (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{t("dashboard.upcoming.title")}</CardTitle>
        <Link
          href="/recurring"
          className="flex items-center gap-0.5 rounded text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("dashboard.upcoming.manage")}{" "}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <CardDescription>
        {t("dashboard.upcoming.window", { days: money.windowDays })}
      </CardDescription>
    </CardHeader>
  );

  if (money.events.length === 0) {
    return (
      <Card>
        {header}
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CalendarClock className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {money.planCount === 0
                ? t("dashboard.upcoming.emptyBody")
                : t("dashboard.upcoming.nothingDue", { days: money.windowDays })}{" "}
              <Link href="/recurring" className="text-primary hover:underline">
                {t("dashboard.upcoming.goToRecurring")}
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const visible = money.events.slice(0, VISIBLE_ROWS);
  const hidden = money.events.length - visible.length;
  // Where this budget period ends. A salary that lands after it belongs to the
  // next period's money, and the row order alone doesn't say so.
  const periodEnd = getFinancialMonthRange(new Date(), startDay).to;
  // Only worth drawing when the break falls inside what's on screen.
  const breakIndex = visible.findIndex((e) => e.date > periodEnd);
  const showBreak = breakIndex > 0;

  return (
    <Card>
      {header}
      <CardContent className="pb-4">
        {/* What the rows below add up to, in the same shape the recurring page
            states a month in: the net first, then the two sides of it. */}
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-3">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-lg font-semibold tabular-nums ${
                money.net >= 0 ? TONE_TEXT.positive : TONE_TEXT.negative
              }`}
            >
              {money.net >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(money.net))}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("dashboard.upcoming.netLabel")}
            </span>
          </div>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {t("recurring.cashFlow.in", { amount: formatCurrency(money.incoming) })}
          </span>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {t("recurring.cashFlow.out", { amount: formatCurrency(money.outgoing) })}
          </span>
        </div>

        <ul>
          {visible.map((event, i) => (
            <Fragment key={event.key}>
              {showBreak && i === breakIndex && (
                <li className="flex items-center gap-3 py-2 text-[11px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {t("dashboard.upcoming.periodBreak", {
                    date: formatDayMonth(periodEnd),
                  })}
                  <span className="h-px flex-1 bg-border" />
                </li>
              )}
              <EventRow event={event} i18n={i18n} />
            </Fragment>
          ))}
        </ul>

        {hidden > 0 && (
          <Link
            href="/recurring"
            className="mt-2 inline-flex items-center gap-0.5 rounded text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {plural(
              hidden,
              "dashboard.upcoming.more.one",
              "dashboard.upcoming.more.other",
              { days: money.windowDays },
            )}{" "}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export function UpcomingMoneyCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="mt-1 h-4 w-64" />
      </CardHeader>
      <CardContent className="pb-4">
        <Skeleton className="mb-3 h-6 w-32" />
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-12 shrink-0" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
