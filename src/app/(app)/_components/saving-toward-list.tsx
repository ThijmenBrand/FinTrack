"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AllocateToPotDialog } from "@/components/allocate-to-pot-dialog";
import { PotDetailDialog } from "@/components/pot-detail-dialog";
import { ON_TRACK_LABEL_KEYS, ON_TRACK_STYLES } from "@/components/spike-progress";
import type { SavingTowardSpike } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface SavingTowardListProps {
  spikes: SavingTowardSpike[];
}

export function SavingTowardList({ spikes }: SavingTowardListProps) {
  const { t, plural, formatCurrency, formatDate } = useI18n();
  const router = useRouter();
  const [activeSpike, setActiveSpike] = useState<SavingTowardSpike | null>(null);
  const [detailPotId, setDetailPotId] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-3">
        {spikes.map((spike) => {
          const pct =
            spike.targetAmount > 0
              ? Math.min(100, Math.round((spike.fundedAmount / spike.targetAmount) * 100))
              : 0;
          const expectedPct =
            spike.targetAmount > 0
              ? Math.min(100, Math.round((spike.expectedFundedByNow / spike.targetAmount) * 100))
              : 0;
          const isFullyFunded = spike.fundedAmount >= spike.targetAmount;
          const paydaysLabel =
            spike.paydaysRemaining === 0
              ? t("dashboard.savingToward.noPaydays")
              : plural(
                  spike.paydaysRemaining,
                  "dashboard.savingToward.paydays.one",
                  "dashboard.savingToward.paydays.other",
                );

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
              className="rounded-lg border p-3 space-y-2 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring outline-none"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {spike.categoryColor && (
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: spike.categoryColor }}
                      />
                    )}
                    <p className="text-sm font-medium truncate">{spike.name}</p>
                    {!isFullyFunded && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 font-normal ${ON_TRACK_STYLES[spike.onTrack]}`}
                      >
                        {t(ON_TRACK_LABEL_KEYS[spike.onTrack])}
                      </Badge>
                    )}
                    {isFullyFunded && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 font-normal border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400"
                      >
                        {t("dashboard.savingToward.fundedBadge")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(spike.targetDate)} · {paydaysLabel}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatCurrency(spike.fundedAmount)}{" "}
                  <span className="text-muted-foreground font-normal">
                    / {formatCurrency(spike.targetAmount)}
                  </span>
                </p>
              </div>

              <div
                className="relative h-2 bg-muted rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("dashboard.savingToward.progressLabel", {
                  name: spike.name,
                  pct,
                  expected: expectedPct,
                })}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: isFullyFunded
                      ? "var(--color-success, #16a34a)"
                      : spike.categoryColor || "var(--color-primary)",
                  }}
                />
                {!isFullyFunded && expectedPct > 0 && expectedPct <= 100 && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-foreground/40"
                    style={{ left: `${expectedPct}%` }}
                    aria-hidden="true"
                    title={t("dashboard.savingToward.expectedByNow", { pct: expectedPct })}
                  />
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  {isFullyFunded
                    ? t("dashboard.savingToward.fullyFunded")
                    : t("dashboard.savingToward.suggestedThisPayday", {
                        amount: formatCurrency(spike.suggestedAllocation),
                      })}
                </p>
                <Button
                  size="sm"
                  variant={isFullyFunded ? "outline" : "default"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSpike(spike);
                  }}
                >
                  {t("dashboard.allocate")}
                </Button>
              </div>
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
