"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Package, PiggyBank } from "lucide-react";
import { formatCurrency as fc } from "@/lib/utils";
import { SpikeProgress, type OnTrack } from "@/components/spike-progress";
import { PlainAmount } from "@/components/plain-amount";
import type { Pot } from "@/types/api";

function dayLabel(targetDate: string): string {
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days} days ago`;
  if (days < 14) return `in ${days} days`;
  return target.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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
  const isSpike = pot.targetAmount != null && pot.targetDate != null;
  const isFullyFunded = pot.targetAmount != null && pot.fundedAmount >= pot.targetAmount;

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
          {isSpike ? (
            <PiggyBank className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </div>

        {isSpike && pot.targetAmount != null && pot.targetDate ? (
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
                  {dayLabel(pot.targetDate)}
                  {paydaysRemaining != null && (
                    <>
                      {" "}
                      · {paydaysRemaining === 1 ? "1 payday" : `${paydaysRemaining} paydays`}
                    </>
                  )}
                </span>
                {!isFullyFunded && suggestedAllocation != null && (
                  <span className="text-muted-foreground tabular-nums">
                    {fc(suggestedAllocation)} this payday
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
                  {isFullyFunded ? "Adjust allocation" : "Allocate"}
                </Button>
              )
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
