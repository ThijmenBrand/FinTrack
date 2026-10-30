"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Package, PiggyBank, Wallet } from "lucide-react";
import { SpikeProgress, type OnTrack } from "@/components/spike-progress";
import { SpendProgress } from "@/components/spend-progress";
import { potPhase, spendStatus } from "@/lib/pot-budget";
import { toIsoDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type { I18n } from "@/lib/i18n/translate";
import { PlainAmount } from "@/components/plain-amount";
import type { Pot } from "@/types/api";

function dayLabel(i18n: I18n, targetDate: string): string {
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return i18n.t("date.today");
  if (days === 1) return i18n.t("date.tomorrow");
  if (days < 0) return i18n.t("pots.card.daysAgo", { count: -days });
  if (days < 14) return i18n.t("date.inDays", { count: days });
  return i18n.formatDayMonth(target);
}

interface PotCardProps {
  pot: Pot;
  /** Optional precomputed on-track status (from saving-toward query). */
  onTrack?: OnTrack;
  /** Optional precomputed expected-funded marker. */
  expectedFundedByNow?: number;
  /** Optional precomputed paydays remaining. */
  paydaysRemaining?: number;
  /** Optional precomputed suggested allocation. */
  suggestedAllocation?: number;
  onClick: () => void;
  onAllocate?: () => void;
}

export function PotCard({
  pot,
  onTrack,
  expectedFundedByNow,
  paydaysRemaining,
  suggestedAllocation,
  onClick,
  onAllocate,
}: PotCardProps) {
  const i18n = useI18n();
  const { t, plural, formatCurrency: fc } = i18n;
  // Saving toward the date, then spending the budget from that day on.
  const phase = potPhase(pot, toIsoDate(new Date()));
  const isFullyFunded = pot.targetAmount != null && pot.fundedAmount >= pot.targetAmount;
  const PhaseIcon = phase === "saving" ? PiggyBank : phase === "spending" ? Wallet : Package;

  return (
    <Card
      onClick={onClick}
      className="cursor-pointer transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-2">
          {pot.categoryColor ? (
            <span
              className="h-2.5 w-2.5 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: pot.categoryColor }}
            />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{pot.name}</p>
            {pot.categoryName && (
              <p className="text-xs text-muted-foreground truncate">
                {pot.categoryName}
              </p>
            )}
          </div>
          <PhaseIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>

        {phase === "saving" && pot.targetAmount != null && pot.targetDate ? (
          <SpikeProgress
            funded={pot.fundedAmount}
            target={pot.targetAmount}
            categoryColor={pot.categoryColor}
            onTrack={onTrack}
            expectedFundedByNow={expectedFundedByNow}
            size="card"
            meta={
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {dayLabel(i18n, pot.targetDate)}
                  {paydaysRemaining != null && (
                    <>
                      {" · "}
                      {plural(paydaysRemaining, "pots.card.paydays.one", "pots.card.paydays.other")}
                    </>
                  )}
                </span>
                {!isFullyFunded && suggestedAllocation != null && (
                  <span className="text-muted-foreground tabular-nums">
                    {t("pots.card.thisPayday", { amount: fc(suggestedAllocation) })}
                  </span>
                )}
              </div>
            }
            footer={
              onAllocate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAllocate();
                  }}
                >
                  {isFullyFunded ? t("pots.card.adjustAllocation") : t("dashboard.allocate")}
                </Button>
              )
            }
          />
        ) : phase === "spending" && pot.targetAmount != null ? (
          <SpendProgress
            spent={pot.spentAmount}
            total={pot.targetAmount}
            status={spendStatus(pot.spentAmount, pot.targetAmount)}
            categoryColor={pot.categoryColor}
            size="card"
            meta={
              <p className="text-xs text-muted-foreground">
                {pot.lineCount > 0
                  ? plural(pot.lineCount, "pots.card.lines.one", "pots.card.lines.other")
                  : plural(pot.transactionCount, "pots.plainCount.one", "pots.plainCount.other")}
              </p>
            }
          />
        ) : (
          <PlainAmount
            netAmount={pot.netAmount}
            transactionCount={pot.transactionCount}
            size="card"
          />
        )}
      </div>
    </Card>
  );
}
