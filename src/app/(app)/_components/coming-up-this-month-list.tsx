"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { PotDetailDialog } from "@/components/pot-detail-dialog";
import type { ThisMonthSpike } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { I18n } from "@/lib/i18n/translate";

function dayLabel(i18n: I18n, daysUntil: number, targetDate: string): string {
  if (daysUntil === 0) return i18n.t("date.today");
  if (daysUntil === 1) return i18n.t("date.tomorrow");
  if (daysUntil < 14) return i18n.t("date.inDays", { count: daysUntil });
  return i18n.formatDayMonth(targetDate);
}

interface ComingUpThisMonthListProps {
  spikes: ThisMonthSpike[];
  freeToSpend: number;
  freeToSpendAfterSpikes: number;
  hasIncome: boolean;
}

export function ComingUpThisMonthList({
  spikes,
  freeToSpend,
  freeToSpendAfterSpikes,
  hasIncome,
}: ComingUpThisMonthListProps) {
  const i18n = useI18n();
  const { t, formatCurrency } = i18n;
  const router = useRouter();
  const [activeSpike, setActiveSpike] = useState<ThisMonthSpike | null>(null);
  const [detailPotId, setDetailPotId] = useState<string | null>(null);

  return (
    <>
      {hasIncome && (
        <div className="mb-4 rounded-md bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t("dashboard.comingUp.afterEvents")} </span>
          <span
            className={`font-semibold tabular-nums ${
              freeToSpendAfterSpikes < 0
                ? "text-red-600 dark:text-red-400"
                : "text-foreground"
            }`}
          >
            {formatCurrency(freeToSpendAfterSpikes)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            {t("dashboard.comingUp.ofFreeToSpend", { amount: formatCurrency(freeToSpend) })}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {spikes.map((spike) => {
          const statusStyles = {
            fits: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400",
            tight:
              "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-400",
            over: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-400",
          }[spike.status];

          const statusLabel = {
            fits: hasIncome
              ? t("dashboard.comingUp.fitsBuffer", { amount: formatCurrency(spike.freeAfter) })
              : t("dashboard.comingUp.fits"),
            tight: hasIncome
              ? t("dashboard.comingUp.tightBuffer", { amount: formatCurrency(spike.freeAfter) })
              : t("dashboard.comingUp.tight"),
            over: hasIncome
              ? t("dashboard.comingUp.overBy", {
                  amount: formatCurrency(Math.abs(spike.freeAfter)),
                })
              : t("dashboard.comingUp.over"),
          }[spike.status];

          return (
            <div
              key={spike.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetailPotId(spike.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetailPotId(spike.id);
                }
              }}
              className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring outline-none"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {spike.categoryColor && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: spike.categoryColor }}
                    />
                  )}
                  <p className="text-sm font-medium truncate">{spike.name}</p>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 font-normal ${statusStyles}`}
                  >
                    {statusLabel}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {dayLabel(i18n, spike.daysUntil, spike.targetDate)} ·{" "}
                  {formatCurrency(spike.targetAmount)}
                  {spike.fundedAmount > 0 && (
                    <>
                      {" · "}
                      {t("dashboard.comingUp.funded", {
                        amount: formatCurrency(spike.fundedAmount),
                      })}
                    </>
                  )}
                </p>
                {spike.categoryWarning && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{spike.categoryWarning}</span>
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveSpike(spike);
                }}
              >
                {t("dashboard.allocate")}
              </Button>
            </div>
          );
        })}
      </div>

      {activeSpike && (
        <AllocateToPotDialog
          open={!!activeSpike}
          onOpenChange={(open) => {
            if (!open) setActiveSpike(null);
          }}
          potId={activeSpike.id}
          potName={activeSpike.name}
          targetAmount={activeSpike.targetAmount}
          fundedAmount={activeSpike.fundedAmount}
          suggestedAmount={activeSpike.suggestedAllocation}
          onAllocated={() => router.refresh()}
        />
      )}

      <PotDetailDialog
        potId={detailPotId}
        onOpenChange={(open) => {
          if (!open) setDetailPotId(null);
        }}
      />
    </>
  );
}
