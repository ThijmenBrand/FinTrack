"use client";

import { useMemo } from "react";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, CalendarClock, Coins } from "lucide-react";
import { PotSaldoGraph, type SaldoPoint } from "@/components/pot-saldo-graph";
import { SpikeProgress } from "@/components/spike-progress";
import { PlainAmount } from "@/components/plain-amount";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { formatCurrency as fc, toIsoDate } from "@/lib/utils";
import type { PotDetails } from "@/types/api";

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface PotDetailContentProps {
  data: PotDetails;
  onAllocate: () => void;
  onEdit: () => void;
  /** Deletes the pot and closes the dialog. */
  onDelete: () => void | Promise<void>;
  deleting: boolean;
}

export function PotDetailContent({
  data,
  onAllocate,
  onEdit,
  onDelete,
  deleting,
}: PotDetailContentProps) {
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
    ? `${fc(pot.fundedAmount)} of ${fc(pot.targetAmount!)} by ${formatLongDate(pot.targetDate!)}`
    : `${transactions.length} transaction${transactions.length === 1 ? "" : "s"} · ${fc(pot.netAmount)} net`;

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
            <span className="sr-only">Edit pot</span>
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
                  ? "today"
                  : spike!.daysUntil === 1
                    ? "tomorrow"
                    : `in ${spike!.daysUntil} days`}{" "}
                ·{" "}
                {spike!.paydaysRemaining === 0
                  ? "no paydays before"
                  : spike!.paydaysRemaining === 1
                    ? "1 payday before"
                    : `${spike!.paydaysRemaining} paydays before`}
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
                  <p className="text-sm font-semibold">Fully funded</p>
                  <p className="text-xs text-muted-foreground">
                    Add more for buffer, or remove some if you over-allocated.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">
                      {fc(spike!.suggestedAllocation)}
                    </span>{" "}
                    suggested this payday
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {spike!.paydaysRemaining === 0
                      ? "No paydays before the event — allocate the remainder now"
                      : `${spike!.paydaysRemaining} payday${spike!.paydaysRemaining === 1 ? "" : "s"} before the event`}
                  </p>
                </>
              )}
            </div>
            <Button
              onClick={onAllocate}
              variant={isFullyFunded ? "outline" : "default"}
            >
              {isFullyFunded ? "Adjust" : "Allocate"}
            </Button>
          </div>
        )}

        {/* Saldo graph */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            Saldo over time
          </h3>
          <PotSaldoGraph
            series={saldoSeries}
            expectedSeries={expectedSeries}
            target={pot.targetAmount ?? null}
            today={todayIso}
            lineColor={pot.categoryColor || undefined}
            ariaLabel={`Saldo for ${pot.name}`}
          />
        </section>

        {/* Allocation history (spike only) */}
        {isSpike && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Allocation history
            </h3>
            {allocations.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No allocations yet — set one aside on payday.
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
          <h3 className="text-sm font-medium text-muted-foreground">
            Linked transactions
          </h3>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No transactions linked yet.
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
              {transactions.length > 20 && (
                <p className="text-xs text-muted-foreground px-3 py-2">
                  Showing 20 of {transactions.length}. View the full list on the transactions page.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Delete */}
        <ConfirmDeleteButton
          variant="text"
          label="Delete pot"
          onConfirm={onDelete}
          pending={deleting}
          message="Delete this pot? Linked transactions will be unlinked but kept."
        />
      </div>
    </>
  );
}
