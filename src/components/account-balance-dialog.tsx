"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { BankLogo } from "@/components/bank-logo";
import { PotSaldoGraph } from "@/components/pot-saldo-graph";
import { useBalanceTimeline } from "@/hooks/use-insights";
import { useBudgetPlans } from "@/hooks/use-budget-plans";
import { toIsoDate } from "@/lib/utils";
import {
  ArrowRight,
  LayoutDashboard,
  PieChart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { Account } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

// ponytail: fixed month presets, no "all time" — the API walks day by day, so an
// unbounded start would build thousands of points. Add a custom range if asked.
const RANGES: { value: string; labelKey: MessageKey; srKey: MessageKey }[] = [
  { value: "1", labelKey: "accountBalance.rangeShort1", srKey: "accountBalance.range1" },
  { value: "3", labelKey: "accountBalance.rangeShort3", srKey: "accountBalance.range3" },
  { value: "6", labelKey: "accountBalance.rangeShort6", srKey: "accountBalance.range6" },
  { value: "12", labelKey: "accountBalance.rangeShort12", srKey: "accountBalance.range12" },
  { value: "24", labelKey: "accountBalance.rangeShort24", srKey: "accountBalance.range24" },
];

const TYPE_KEYS: Record<string, MessageKey> = {
  checking: "accounts.type.checking",
  savings: "accounts.type.savings",
  joint: "accounts.type.joint",
  credit: "accounts.type.credit",
  other: "accounts.type.other",
};

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toIsoDate(d);
}

function Body({ account }: { account: Account }) {
  const { t, formatCurrency } = useI18n();
  const [months, setMonths] = useState("6");
  // Cached by the accounts page and the budget pages alike, so this is a read
  // off the query cache in practice rather than a fetch on open.
  const { data: planData } = useBudgetPlans();
  const plan = planData?.plans.find((p) => p.id === account.budgetId) ?? null;
  const { data, isLoading } = useBalanceTimeline({
    accountId: account.id,
    dateFrom: monthsAgo(Number(months)),
    dateTo: toIsoDate(new Date()),
  });

  const historical = data?.historical ?? [];
  const series = historical.map((p) => ({ date: p.date, value: p.balance }));
  const change =
    series.length > 1 ? series[series.length - 1].value - series[0].value : 0;
  const Trend = change >= 0 ? TrendingUp : TrendingDown;

  return (
    <>
      <DialogHeader>
        <div className="flex items-start gap-3 pr-8">
          <BankLogo bank={account.bank} size={40} />
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="truncate">{account.name}</DialogTitle>
            <DialogDescription className="mt-1 truncate">
              {account.bankName || t("accounts.noBank")}
              {" · "}
              {t(TYPE_KEYS[account.type] ?? "accounts.type.other")}
            </DialogDescription>
            {account.iban && (
              // The card shows this too; repeating it here is how you confirm
              // you opened the account you meant to.
              <p className="truncate font-mono text-xs text-muted-foreground">
                {account.iban}
              </p>
            )}
          </div>
        </div>
      </DialogHeader>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {t("accountBalance.currentBalance")}
          </p>
          <p
            className={`text-3xl font-bold tabular-nums tracking-tight ${
              account.currentBalance >= 0
                ? "text-foreground"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {formatCurrency(account.currentBalance, account.currency)}
          </p>
        </div>
        {/* Range switch sits with the delta it governs, so changing it visibly
            changes the number underneath rather than only the chart. */}
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Segmented
            name="account-balance-range"
            legend={t("accountBalance.timeRange")}
            value={months}
            onChange={setMonths}
            options={RANGES.map((r) => ({
              value: r.value,
              label: t(r.labelKey),
              srLabel: t(r.srKey),
            }))}
          />
          {change !== 0 && (
            <p
              className={`flex items-center gap-1.5 text-xs font-medium tabular-nums ${
                change >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400"
              }`}
            >
              <Trend className="h-3.5 w-3.5 shrink-0" />
              {t("accountBalance.overRange", {
                amount: `${change >= 0 ? "+" : ""}${formatCurrency(change, account.currency)}`,
              })}
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[220px] w-full rounded-lg" />
      ) : (
        <PotSaldoGraph
          series={series}
          showPoints={false}
          ariaLabel={t("accountBalance.chartAria", { name: account.name })}
          emptyMessage={t("accountBalance.empty")}
        />
      )}

      {/* The chart raises questions the transaction list answers; the dialog
          used to be a dead end. */}
      <div className="space-y-2.5 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* Which budget this account's spending lands in, and a way into it —
              the account card never says. */}
          {plan ? (
            <DialogClose asChild>
              <Link
                href={`/budgets?plan=${encodeURIComponent(plan.id)}`}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={t("accountBalance.viewBudget", { name: plan.name })}
              >
                <Wallet className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{plan.name}</span>
              </Link>
            </DialogClose>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              {t("accountBalance.noBudget")}
            </p>
          )}
          <DialogClose asChild>
            <Link
              href={`/transactions?account=${account.id}`}
              className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t("accountBalance.viewTransactions")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </DialogClose>
        </div>
        {/* An account is only ever part of a budget's picture, so the two pages
            that draw that picture open on this account's budget rather than on
            whichever one the dashboard happens to default to. Pointless without
            a budget — both would just land on the default view. */}
        {plan && (
          <div className="flex flex-wrap gap-2">
            <DialogClose asChild>
              <Link
                href={`/?budget=${encodeURIComponent(plan.id)}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                aria-label={t("accountBalance.viewDashboardFor", { name: plan.name })}
              >
                <LayoutDashboard aria-hidden="true" />
                {t("accountBalance.viewDashboard")}
              </Link>
            </DialogClose>
            <DialogClose asChild>
              <Link
                href={`/insights?budget=${encodeURIComponent(plan.id)}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                aria-label={t("accountBalance.viewInsightsFor", { name: plan.name })}
              >
                <PieChart aria-hidden="true" />
                {t("accountBalance.viewInsights")}
              </Link>
            </DialogClose>
          </div>
        )}
      </div>
    </>
  );
}

export function AccountBalanceDialog({
  account,
  onOpenChange,
}: {
  account: Account | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Mounted only while open, so no timeline is fetched for a closed dialog. */}
        {account && <Body account={account} />}
      </DialogContent>
    </Dialog>
  );
}
