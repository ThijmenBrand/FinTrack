"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BankLogo } from "@/components/bank-logo";
import { PotSaldoGraph } from "@/components/pot-saldo-graph";
import { useBalanceTimeline } from "@/hooks/use-insights";
import { toIsoDate } from "@/lib/utils";
import type { Account } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

// ponytail: fixed month presets, no "all time" — the API walks day by day, so an
// unbounded start would build thousands of points. Add a custom range if asked.
const RANGES: { value: string; labelKey: MessageKey }[] = [
  { value: "1", labelKey: "accountBalance.range1" },
  { value: "3", labelKey: "accountBalance.range3" },
  { value: "6", labelKey: "accountBalance.range6" },
  { value: "12", labelKey: "accountBalance.range12" },
  { value: "24", labelKey: "accountBalance.range24" },
];

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toIsoDate(d);
}

function Body({ account }: { account: Account }) {
  const { t, formatCurrency } = useI18n();
  const [months, setMonths] = useState("6");
  const { data, isLoading } = useBalanceTimeline({
    accountId: account.id,
    dateFrom: monthsAgo(Number(months)),
    dateTo: toIsoDate(new Date()),
  });

  const historical = data?.historical ?? [];
  const series = historical.map((p) => ({ date: p.date, value: p.balance }));
  const change =
    series.length > 1 ? series[series.length - 1].value - series[0].value : 0;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <BankLogo bank={account.bank} size={40} />
          <div className="min-w-0 text-left">
            <DialogTitle className="truncate">{account.name}</DialogTitle>
            <DialogDescription>
              {account.bankName || t("accounts.noBank")}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">{t("accountBalance.currentBalance")}</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight">
            {formatCurrency(account.currentBalance, account.currency)}
          </p>
          {change !== 0 && (
            <p
              className={`text-xs font-medium tabular-nums ${
                change >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400"
              }`}
            >
              {t("accountBalance.overRange", {
                amount: `${change >= 0 ? "+" : ""}${formatCurrency(change, account.currency)}`,
              })}
            </p>
          )}
        </div>
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="w-[160px]" aria-label={t("accountBalance.timeRange")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {t(r.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
