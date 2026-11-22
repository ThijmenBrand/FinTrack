export const dynamic = "force-dynamic";

import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BankLogo } from "@/components/bank-logo";
import { requireAuth } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { valuationAgeDays } from "@/lib/account-kinds";
import { getInvestmentsOverview } from "./_lib/queries";
import { GapChart } from "./_components/gap-chart";
import { UpdateValueDialog } from "./_components/update-value-dialog";

/**
 * The investments page answers three questions, in this order: what is it
 * worth, what did it cost me, and is the gap growing. Everything on the page
 * serves that sequence — there is no tile row, because a row of six numbers
 * answers none of them.
 */
export default async function InvestmentsPage() {
  const { userId } = await requireAuth();
  const [overview, { t, formatCurrency, formatDayMonth }] = await Promise.all([
    getInvestmentsOverview(userId),
    getI18n(),
  ]);

  if (!overview) {
    return (
      <div className="space-y-6">
        <Header title={t("investments.title")} subtitle={t("investments.subtitle")} />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <TrendingUp className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="mb-1 font-medium">{t("investments.empty.title")}</p>
            <p className="mb-6 max-w-sm text-sm text-muted-foreground">
              {t("investments.empty.body")}
            </p>
            <Link href="/accounts?new=1" className={buttonVariants()}>
              {t("investments.empty.action")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const {
    accounts,
    totalValue,
    totalContributed,
    gain,
    gainPercent,
    valuedAt,
    stale,
    everValued,
    cash,
    netWorth,
    points,
    valuationDates,
  } = overview;
  const age = valuationAgeDays(valuedAt);
  const up = (gain ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Header title={t("investments.title")} subtitle={t("investments.subtitle")} />
        <UpdateValueDialog
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            currentValue: a.currentValue,
            valuedAt: a.valuedAt,
          }))}
        />
      </div>

      <Card>
        <CardHeader>
          {/* Three numbers, not six. Value leads because it is the question
              people open this page with; the other two explain it. */}
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {t("investments.value")}
              </p>
              <p className="text-3xl font-semibold tabular-nums tracking-tight">
                {everValued ? formatCurrency(totalValue) : "—"}
              </p>
              <p
                className={`mt-0.5 text-xs ${
                  stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                }`}
              >
                {!everValued
                  ? t("investments.neverValued")
                  : valuedAt === null
                    ? t("investments.someNeverValued")
                    : age === 0
                      ? t("investments.valuedToday")
                      : t("investments.valuedOn", { date: formatDayMonth(valuedAt) })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("investments.putIn")}
              </p>
              <p className="text-xl font-medium tabular-nums tracking-tight">
                {formatCurrency(totalContributed)}
              </p>
            </div>
            {gain !== null && (
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("investments.return")}
                </p>
                <p
                  className={`text-xl font-semibold tabular-nums tracking-tight ${
                    up
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {up ? "+" : ""}
                  {formatCurrency(gain)}
                  {gainPercent !== null && (
                    <span className="ml-1.5 text-sm font-normal">
                      ({up ? "+" : ""}
                      {gainPercent.toFixed(1)}%)
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <GapChart points={points} valuationDates={valuationDates} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t("investments.accounts")}</CardTitle>
            <CardDescription>{t("investments.accountsHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-md:space-y-0">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:px-0 max-md:last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <BankLogo bank={account.bank} size={36} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <p
                        className={`truncate text-xs ${
                          account.stale
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {account.valuedAt
                          ? t("investments.valuedOn", {
                              date: formatDayMonth(account.valuedAt),
                            })
                          : t("investments.neverValued")}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {account.currentValue === null
                        ? "—"
                        : formatCurrency(account.currentValue)}
                    </p>
                    {account.gain !== null && (
                      <p
                        className={`text-xs tabular-nums ${
                          account.gain >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {account.gain >= 0 ? "+" : ""}
                        {formatCurrency(account.gain)}{" "}
                        <span className="text-muted-foreground">
                          {t("investments.onPutIn", {
                            amount: formatCurrency(account.contributed),
                          })}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("investments.netWorth")}</CardTitle>
            <CardDescription>{t("investments.netWorthHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Written as arithmetic rather than one opaque total: the point
                of the figure is that you can see what it is made of. */}
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{t("investments.cash")}</dt>
                <dd className="tabular-nums">{formatCurrency(cash)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">
                  {t("investments.investments")}
                </dt>
                <dd className="tabular-nums">{formatCurrency(totalValue)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t pt-2">
                <dt className="font-medium">{t("investments.netWorth")}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatCurrency(netWorth)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
