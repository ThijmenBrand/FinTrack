"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, CalendarClock, Coins, Archive, ArchiveRestore } from "lucide-react";
import { PotSaldoGraph, type SaldoPoint } from "@/components/pot-saldo-graph";
import { SpikeProgress } from "@/components/spike-progress";
import { PlainAmount } from "@/components/plain-amount";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { toIsoDate } from "@/lib/utils";
import type { PotDetails } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface PotDetailContentProps {
  data: PotDetails;
  onAllocate: () => void;
  onEdit: () => void;
  /** Deletes the pot and closes the dialog. */
  onDelete: () => void | Promise<void>;
  deleting: boolean;
  /** Archives or unarchives the pot and closes the dialog. */
  onArchive: () => void | Promise<void>;
  archiving: boolean;
}

export function PotDetailContent({
  data,
  onAllocate,
  onEdit,
  onDelete,
  deleting,
  onArchive,
  archiving,
}: PotDetailContentProps) {
  const { t, plural, formatCurrency: fc, formatDate: formatLongDate } = useI18n();
  const { pot, spike, allocations, transactions } = data;
  const isSpike = spike != null && pot.targetAmount != null && pot.targetDate;
  const isFullyFunded =
    isSpike && pot.targetAmount != null && pot.fundedAmount >= pot.targetAmount;

  // Build saldo series.
  const saldoSeries: SaldoPoint[] = useMemo(() => {
    if (isSpike) {
      const points: SaldoPoint[] = [
        { date: pot.createdAt.slice(0, 10), value: 0 },
      ];
      for (const a of allocations) {
        points.push({ date: a.date.slice(0, 10), value: a.fundedAfter });
      }
      const todayIso = toIsoDate(new Date());
      const lastPoint = points[points.length - 1];
      if (lastPoint.date < todayIso) {
        points.push({ date: todayIso, value: pot.fundedAmount });
      }
      return points;
    }
    // Plain pot: cumulative running net of linked transactions.
    if (transactions.length === 0) return [];
    const sorted = [...transactions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const points: SaldoPoint[] = [];
    let running = 0;
    for (const t of sorted) {
      running += t.amount;
      points.push({ date: t.date, value: running });
    }
    return points;
  }, [isSpike, pot.createdAt, pot.fundedAmount, allocations, transactions]);

  const expectedSeries: SaldoPoint[] | undefined =
    isSpike && spike?.paydaySchedule.length
      ? [
          { date: pot.createdAt.slice(0, 10), value: 0 },
          ...spike.paydaySchedule.map((p) => ({
            date: p.date,
            value: p.expectedFunded,
          })),
        ]
      : undefined;

  const todayIso = toIsoDate(new Date());

  const description = isSpike
    ? t("pots.detail.spikeDescription", {
        funded: fc(pot.fundedAmount),
        target: fc(pot.targetAmount!),
        date: formatLongDate(pot.targetDate!),
      })
    : plural(
        transactions.length,
        "pots.detail.plainDescription.one",
        "pots.detail.plainDescription.other",
        { net: fc(pot.netAmount) },
      );

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-lg">
              {pot.categoryColor && (
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: pot.categoryColor }}
                />
              )}
              <span className="truncate">{pot.name}</span>
              {pot.categoryName && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {pot.categoryName}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 -mt-1 -mr-2"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">{t("pots.detail.editPot")}</span>
          </Button>
        </div>
      </DialogHeader>

      <div className="px-6 pb-6 space-y-5 overflow-y-auto">
        {/* Hero / progress */}
        {isSpike && pot.targetAmount != null ? (
          <SpikeProgress
            funded={pot.fundedAmount}
            target={pot.targetAmount}
            categoryColor={pot.categoryColor}
            onTrack={spike!.onTrack}
            expectedFundedByNow={spike!.expectedFundedByNow}
            size="detail"
            meta={
              <p className="text-xs text-muted-foreground">
                {spike!.daysUntil === 0
                  ? t("date.today")
                  : spike!.daysUntil === 1
                    ? t("date.tomorrow")
                    : t("date.inDays", { count: spike!.daysUntil })}{" "}
                ·{" "}
                {spike!.paydaysRemaining === 0
                  ? t("pots.detail.noPaydaysBefore")
                  : plural(
                      spike!.paydaysRemaining,
                      "pots.detail.paydaysBefore.one",
                      "pots.detail.paydaysBefore.other",
                    )}
              </p>
            }
          />
        ) : (
          <PlainAmount
            netAmount={pot.netAmount}
            transactionCount={transactions.length}
            size="detail"
          />
        )}

        {/* Allocation callout — adapts to funded state */}
        {isSpike && (
          <div className="rounded-lg border bg-primary/5 p-4 flex items-center gap-3">
            <Coins className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              {isFullyFunded ? (
                <>
                  <p className="text-sm font-semibold">{t("pots.detail.fullyFunded")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("pots.detail.fullyFundedHint")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">
                      {fc(spike!.suggestedAllocation)}
                    </span>{" "}
                    {t("pots.detail.suggestedThisPayday")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {spike!.paydaysRemaining === 0
                      ? t("pots.detail.noPaydaysHint")
                      : plural(
                          spike!.paydaysRemaining,
                          "pots.detail.paydaysBeforeEvent.one",
                          "pots.detail.paydaysBeforeEvent.other",
                        )}
                  </p>
                </>
              )}
            </div>
            <Button
              onClick={onAllocate}
              variant={isFullyFunded ? "outline" : "default"}
            >
              {isFullyFunded ? t("pots.detail.adjust") : t("dashboard.allocate")}
            </Button>
          </div>
        )}

        {/* Saldo graph */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            {t("pots.detail.saldoOverTime")}
          </h3>
          <PotSaldoGraph
            series={saldoSeries}
            expectedSeries={expectedSeries}
            target={pot.targetAmount ?? null}
            today={todayIso}
            lineColor={pot.categoryColor || undefined}
            ariaLabel={t("pots.detail.saldoAria", { name: pot.name })}
          />
        </section>

        {/* Allocation history (spike only) */}
        {isSpike && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("pots.detail.allocationHistory")}
            </h3>
            {allocations.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                {t("pots.detail.noAllocations")}
              </p>
            ) : (
              <div className="rounded-lg border divide-y">
                {[...allocations].reverse().map((a, i) => (
                  <div
                    key={`${a.date}-${i}`}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {formatLongDate(a.date)}
                    </span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span
                        className={
                          a.delta >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {a.delta >= 0 ? "+" : ""}
                        {fc(a.delta)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        funded {fc(a.fundedAfter)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Linked transactions */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("pots.detail.linkedTransactions")}
            </h3>
            {isSpike && transactions.length > 0 && (
              <span
                className={`text-sm font-medium tabular-nums ${
                  pot.netAmount === 0
                    ? "text-muted-foreground"
                    : pot.netAmount > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                }`}
              >
                {t("pots.detail.netSuffix", {
                  amount: `${pot.netAmount >= 0 ? "+" : ""}${fc(pot.netAmount)}`,
                })}
              </span>
            )}
          </div>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {t("pots.detail.noLinked")}
            </p>
          ) : (
            <div className="rounded-lg border divide-y">
              {transactions.slice(0, 20).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between px-3 py-2 text-sm gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatLongDate(tx.date)}
                      {tx.categoryName && (
                        <> · <span style={{ color: tx.categoryColor || undefined }}>{tx.categoryName}</span></>
                      )}
                    </p>
                  </div>
                  <span
                    className={`tabular-nums shrink-0 ${
                      tx.amount >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {tx.amount >= 0 ? "+" : ""}
                    {fc(tx.amount)}
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground px-3 py-2">
                {transactions.length > 20 &&
                  `${t("pots.detail.showingOf", { total: transactions.length })} `}
                <Link
                  href={`/transactions?pot=${pot.id}`}
                  className="text-primary hover:underline"
                >
                  {t("pots.detail.viewFullList")}
                </Link>
                .
              </p>
            </div>
          )}
        </section>

        {/* Archive + Delete */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={archiving}>
            {pot.archivedAt ? (
              <>
                <ArchiveRestore className="h-4 w-4" />
                {t("pots.detail.unarchive")}
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" />
                {t("pots.detail.archive")}
              </>
            )}
          </Button>
          <ConfirmDeleteButton
            variant="text"
            label={t("pots.detail.deletePot")}
            onConfirm={onDelete}
            pending={deleting}
            message={t("pots.detail.deleteConfirm")}
          />
        </div>
      </div>
    </>
  );
}
