"use client";

import { useMemo } from "react";
import { CalendarClock, Coins } from "lucide-react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PotSaldoGraph } from "@/components/pot-saldo-graph";
import { SpikeProgress } from "@/components/spike-progress";
import { SpendProgress } from "@/components/spend-progress";
import { PlainAmount } from "@/components/plain-amount";
import { potGraph } from "@/lib/pot-saldo";
import type { PotPhase } from "@/lib/pot-budget";
import type { PotDetails } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface PotHeroProps {
  data: PotDetails;
  phase: PotPhase;
  todayIso: string;
  onAllocate: () => void;
}

/**
 * The top of the pot dialog: what the pot is, and the one figure that matters
 * for where it is now — saved so far while it saves toward its date, spent
 * against the budget once it's being spent, the net for a plain pot.
 */
export function PotHero({ data, phase, todayIso, onAllocate }: PotHeroProps) {
  const { t, plural, formatCurrency: fc, formatDate } = useI18n();
  const { pot, spike, allocations, transactions, budget } = data;
  const saving = phase === "saving" && spike != null && pot.targetAmount != null && pot.targetDate != null;
  const isFullyFunded = saving && pot.fundedAmount >= pot.targetAmount!;

  const graph = useMemo(
    () =>
      potGraph({
        // Without spike stats there's no schedule to save along; show spend.
        phase: saving ? "saving" : phase === "none" ? "none" : "spending",
        createdAt: pot.createdAt,
        targetAmount: pot.targetAmount,
        fundedAmount: pot.fundedAmount,
        allocations,
        transactions,
        paydaySchedule: spike?.paydaySchedule,
        todayIso,
      }),
    [saving, phase, pot.createdAt, pot.targetAmount, pot.fundedAmount, allocations, transactions, spike, todayIso],
  );

  const description = saving
    ? t("pots.detail.spikeDescription", {
        funded: fc(pot.fundedAmount),
        target: fc(pot.targetAmount!),
        date: formatDate(pot.targetDate!),
      })
    : phase !== "none" && pot.targetAmount != null
      ? pot.targetDate
        ? t("pots.hero.spendingSince", { date: formatDate(pot.targetDate) })
        : t("pots.hero.spending")
      : plural(transactions.length, "pots.detail.plainDescription.one", "pots.detail.plainDescription.other", {
          net: fc(pot.netAmount),
        });

  return (
    <>
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="flex items-center gap-2 text-lg">
          <span
            className="h-3 w-3 shrink-0 rounded-full bg-muted"
            style={pot.categoryColor ? { backgroundColor: pot.categoryColor } : undefined}
          />
          <span className="truncate">{pot.name}</span>
          {pot.categoryName && (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
              {pot.categoryName}
            </Badge>
          )}
          {pot.archivedAt && (
            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
              {t("pots.hero.archived")}
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {saving ? (
        <SpikeProgress
          funded={pot.fundedAmount}
          target={pot.targetAmount!}
          categoryColor={pot.categoryColor}
          onTrack={spike!.onTrack}
          expectedFundedByNow={spike!.expectedFundedByNow}
          size="detail"
          meta={
            <p className="text-xs text-muted-foreground">
              {spike!.daysUntil === 1 ? t("date.tomorrow") : t("date.inDays", { count: spike!.daysUntil })}
              {" · "}
              {spike!.paydaysRemaining === 0
                ? t("pots.detail.noPaydaysBefore")
                : plural(spike!.paydaysRemaining, "pots.detail.paydaysBefore.one", "pots.detail.paydaysBefore.other")}
            </p>
          }
        />
      ) : phase !== "none" && budget.total != null ? (
        <SpendProgress
          spent={budget.spent}
          total={budget.total}
          status={budget.status}
          categoryColor={pot.categoryColor}
          size="detail"
        />
      ) : (
        <PlainAmount netAmount={pot.netAmount} transactionCount={transactions.length} size="detail" />
      )}

      {saving && (
        <div className="flex items-center gap-3 rounded-lg border bg-primary/5 p-3 sm:p-4">
          <Coins className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            {isFullyFunded ? (
              <>
                <p className="text-sm font-semibold">{t("pots.detail.fullyFunded")}</p>
                <p className="text-xs text-muted-foreground">{t("pots.detail.fullyFundedHint")}</p>
              </>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-semibold">{fc(spike!.suggestedAllocation)}</span>{" "}
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
          <Button onClick={onAllocate} variant={isFullyFunded ? "outline" : "default"} size="sm">
            {isFullyFunded ? t("pots.detail.adjust") : t("dashboard.allocate")}
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          {saving || phase === "none" ? t("pots.detail.saldoOverTime") : t("pots.hero.spentOverTime")}
        </h3>
        <PotSaldoGraph
          series={graph.series}
          expectedSeries={graph.expected}
          target={graph.target}
          today={todayIso}
          lineColor={pot.categoryColor || undefined}
          ariaLabel={t("pots.detail.saldoAria", { name: pot.name })}
          height={180}
        />
      </section>

      {saving && allocations.length > 0 && (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            {t("pots.detail.allocationHistory")}
            <span className="ml-1.5 text-xs tabular-nums">{allocations.length}</span>
          </summary>
          <ul className="divide-y border-t">
            {[...allocations].reverse().map((a, i) => (
              <li key={`${a.date}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">{formatDate(a.date)}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  <span className={a.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {a.delta >= 0 ? "+" : ""}
                    {fc(a.delta)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("pots.detail.fundedAfter", { amount: fc(a.fundedAfter) })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
