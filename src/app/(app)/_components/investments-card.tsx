import Link from "next/link";
import { TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BankLogo } from "@/components/bank-logo";
import { getInvestmentSummary } from "../_lib/dashboard-queries";
import { getInvestmentSeries } from "@/lib/investment-series";
import { GapSparkline } from "./gap-sparkline";
import { getI18n } from "@/lib/i18n/server";
import { valuationAgeDays, isValuationStale } from "@/lib/account-kinds";

/**
 * What the portfolio is worth, next to what the ledger says went into it.
 *
 * The sparkline appears only once there are two valuations to draw between —
 * a line through a single point would assert a history the data does not have.
 * Until then the two numbers and the gap are the whole story.
 */
export async function InvestmentsCard({ userId }: { userId: string }) {
  const [summary, series, { t, formatCurrency, formatDayMonth }] = await Promise.all([
    getInvestmentSummary(userId),
    getInvestmentSeries(userId, "1970-01-01"),
    getI18n(),
  ]);

  // No investment accounts: no card. Nothing here is worth a permanent empty
  // state on everyone's dashboard.
  if (!summary) return null;

  const { accounts, totalValue, totalContributed, investedThisYear, valuedAt } =
    summary;
  const everValued = accounts.some((a) => a.currentValue !== null);

  // Return is only honest once the ledger knows what went in. Without any
  // contributions it would equal the whole value and read as "+100%", which
  // is an artefact of missing transfers, not a result.
  const showReturn = everValued && totalContributed > 0;
  const gain = totalValue - totalContributed;
  const gainPercent = totalContributed > 0 ? (gain / totalContributed) * 100 : 0;
  const up = gain >= 0;

  const age = valuationAgeDays(valuedAt);
  const stale = isValuationStale(valuedAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle>
            <Link href="/investments" className="hover:underline">
              {t("dashboard.investments.title")}
            </Link>
          </CardTitle>
          <span className="text-sm font-semibold tabular-nums max-md:text-lg">
            {everValued ? formatCurrency(totalValue) : "—"}
          </span>
        </div>
        {/* The as-of date is not a footnote. A valuation with no date on it is
            a number quietly claiming to be live, and amber is how this app
            says "this needs you". */}
        <CardDescription className={stale ? "text-amber-600 dark:text-amber-400" : ""}>
          {!everValued
            ? t("dashboard.investments.neverValued")
            : valuedAt === null
              ? t("dashboard.investments.someNeverValued")
              : age === 0
                ? t("dashboard.investments.valuedToday")
                : t("dashboard.investments.valuedOn", {
                    date: formatDayMonth(valuedAt),
                  })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GapSparkline points={series.points} />
        {everValued ? (
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">
                {t("dashboard.investments.putIn")}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatCurrency(totalContributed)}
              </dd>
            </div>
            {showReturn && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">
                  {t("dashboard.investments.return")}
                </dt>
                <dd
                  className={`font-semibold tabular-nums ${
                    up
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {up ? "+" : ""}
                  {formatCurrency(gain)}
                  <span className="ml-1.5 font-normal text-xs">
                    ({up ? "+" : ""}
                    {gainPercent.toFixed(1)}%)
                  </span>
                </dd>
              </div>
            )}
            {investedThisYear !== 0 && (
              <div className="flex items-baseline justify-between gap-2 border-t pt-1.5">
                <dt className="text-muted-foreground">
                  {t("dashboard.investments.thisYear")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatCurrency(investedThisYear)}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <TrendingUp className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {t("dashboard.investments.emptyValue")}
            </p>
          </div>
        )}

        <div className="space-y-2 max-md:space-y-0">
          {accounts.map((account) => (
            <Link
              key={account.id}
              href="/investments"
              className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:border-border/60 max-md:px-0 max-md:last:border-b-0 max-md:active:bg-muted/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <BankLogo bank={account.bank} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  <p
                    className={`truncate text-xs ${
                      isValuationStale(account.valuedAt)
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {account.valuedAt
                      ? t("dashboard.investments.valuedOn", {
                          date: formatDayMonth(account.valuedAt),
                        })
                      : t("dashboard.investments.neverValued")}
                  </p>
                </div>
              </div>
              <p className="shrink-0 pl-2 text-sm font-semibold tabular-nums">
                {account.currentValue === null
                  ? "—"
                  : formatCurrency(account.currentValue)}
              </p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function InvestmentsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-1 h-4 w-24" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div>
              <Skeleton className="mb-1 h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}
