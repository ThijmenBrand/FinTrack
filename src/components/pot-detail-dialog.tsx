"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  CalendarClock,
  Coins,
} from "lucide-react";
import { usePotDetails, useDeletePot } from "@/hooks/use-pots";
import { useCategories } from "@/hooks/use-categories";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { EditPotDialog } from "@/components/edit-pot-dialog";
import { PotSaldoGraph, type SaldoPoint } from "@/components/pot-saldo-graph";
import type { PotDetails } from "@/types/api";

const eur = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});
const fc = (n: number) => eur.format(n);

const ON_TRACK_LABEL = {
  ahead: "Ahead",
  on_pace: "On pace",
  behind: "Behind",
} as const;

const ON_TRACK_STYLES = {
  ahead:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400",
  on_pace:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-400",
  behind:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-400",
} as const;

interface PotDetailDialogProps {
  potId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PotDetailDialog({ potId, onOpenChange }: PotDetailDialogProps) {
  const open = !!potId;
  const { data, isLoading } = usePotDetails(potId);
  const { data: categories = [] } = useCategories();
  const deletePot = useDeletePot();

  const [showAllocate, setShowAllocate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    if (!potId) return;
    await deletePot.mutateAsync(potId);
    setConfirmDelete(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0">
          {isLoading || !data ? (
            <DetailSkeleton />
          ) : (
            <Loaded
              data={data}
              onAllocate={() => setShowAllocate(true)}
              onEdit={() => setShowEdit(true)}
              onDelete={() => setConfirmDelete(true)}
              confirmingDelete={confirmDelete}
              cancelDelete={() => setConfirmDelete(false)}
              executeDelete={handleDelete}
              deleting={deletePot.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {data && (
        <>
          {data.spike && (
            <AllocateToPotDialog
              open={showAllocate}
              onOpenChange={setShowAllocate}
              potId={data.pot.id}
              potName={data.pot.name}
              targetAmount={data.pot.targetAmount ?? 0}
              fundedAmount={data.pot.fundedAmount}
              suggestedAmount={data.spike.suggestedAllocation}
            />
          )}
          <EditPotDialog
            open={showEdit}
            onOpenChange={setShowEdit}
            categories={categories}
            pot={data.pot}
          />
        </>
      )}
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <DialogHeader className="px-6 pt-6">
        <DialogTitle>
          <Skeleton className="h-6 w-48" />
        </DialogTitle>
        <DialogDescription>
          <Skeleton className="h-4 w-72" />
        </DialogDescription>
      </DialogHeader>
      <div className="px-6 pb-6 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[220px] w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </>
  );
}

interface LoadedProps {
  data: PotDetails;
  onAllocate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  cancelDelete: () => void;
  executeDelete: () => void;
  deleting: boolean;
}

function Loaded({
  data,
  onAllocate,
  onEdit,
  onDelete,
  confirmingDelete,
  cancelDelete,
  executeDelete,
  deleting,
}: LoadedProps) {
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
      const todayIso = new Date().toISOString().slice(0, 10);
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

  const todayIso = new Date().toISOString().slice(0, 10);

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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 -mt-1 -mr-2">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Pot actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit pot
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
                className="text-red-600 dark:text-red-400 focus:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Delete pot
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DialogHeader>

      <div className="px-6 pb-6 space-y-5 overflow-y-auto">
        {/* Hero / progress */}
        {isSpike && pot.targetAmount != null ? (
          <SpikeHero
            funded={pot.fundedAmount}
            target={pot.targetAmount}
            expected={spike!.expectedFundedByNow}
            onTrack={spike!.onTrack}
            isFullyFunded={!!isFullyFunded}
            daysUntil={spike!.daysUntil}
            paydaysRemaining={spike!.paydaysRemaining}
            categoryColor={pot.categoryColor}
          />
        ) : (
          <PlainHero
            netAmount={pot.netAmount}
            transactionCount={transactions.length}
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
            style="step"
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

        {/* Confirm-delete inline strip */}
        {confirmingDelete && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 flex items-center justify-between gap-3">
            <p className="text-sm">
              Delete this pot? Linked transactions will be unlinked but kept.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={cancelDelete}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={executeDelete}
                disabled={deleting}
              >
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SpikeHero({
  funded,
  target,
  expected,
  onTrack,
  isFullyFunded,
  daysUntil,
  paydaysRemaining,
  categoryColor,
}: {
  funded: number;
  target: number;
  expected: number;
  onTrack: "ahead" | "on_pace" | "behind";
  isFullyFunded: boolean;
  daysUntil: number;
  paydaysRemaining: number;
  categoryColor: string | null;
}) {
  const pct = target > 0 ? Math.min(100, (funded / target) * 100) : 0;
  const expectedPct = target > 0 ? Math.min(100, (expected / target) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-3xl font-bold tabular-nums leading-none">
            {fc(funded)}{" "}
            <span className="text-lg font-normal text-muted-foreground">
              / {fc(target)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {daysUntil === 0
              ? "today"
              : daysUntil === 1
                ? "tomorrow"
                : `in ${daysUntil} days`}{" "}
            ·{" "}
            {paydaysRemaining === 0
              ? "no paydays before"
              : paydaysRemaining === 1
                ? "1 payday before"
                : `${paydaysRemaining} paydays before`}
          </p>
        </div>
        {isFullyFunded ? (
          <Badge
            variant="outline"
            className="text-xs px-2 py-0.5 font-medium border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400"
          >
            Funded
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={`text-xs px-2 py-0.5 font-medium ${ON_TRACK_STYLES[onTrack]}`}
          >
            {ON_TRACK_LABEL[onTrack]}
          </Badge>
        )}
      </div>

      <div className="relative h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: isFullyFunded
              ? "var(--color-success, #16a34a)"
              : categoryColor || "var(--color-primary)",
          }}
        />
        {!isFullyFunded && expectedPct > 0 && expectedPct <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-foreground/40"
            style={{ left: `${expectedPct}%` }}
            title={`Expected by now: ${fc(expected)}`}
          />
        )}
      </div>
    </div>
  );
}

function PlainHero({
  netAmount,
  transactionCount,
}: {
  netAmount: number;
  transactionCount: number;
}) {
  return (
    <div>
      <p
        className={`text-3xl font-bold tabular-nums leading-none ${
          netAmount >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
        }`}
      >
        {netAmount >= 0 ? "+" : ""}
        {fc(netAmount)}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {transactionCount} transaction{transactionCount === 1 ? "" : "s"} grouped
      </p>
    </div>
  );
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
