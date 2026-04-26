"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Package, PiggyBank } from "lucide-react";
import type { Pot } from "@/types/api";

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
  onTrack?: "ahead" | "on_pace" | "behind";
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
          <SpikeBody
            funded={pot.fundedAmount}
            target={pot.targetAmount}
            targetDate={pot.targetDate}
            categoryColor={pot.categoryColor}
            onTrack={onTrack}
            expectedFundedByNow={expectedFundedByNow}
            paydaysRemaining={paydaysRemaining}
            suggestedAllocation={suggestedAllocation}
            onAllocate={onAllocate}
          />
        ) : (
          <PlainBody
            netAmount={pot.netAmount}
            transactionCount={pot.transactionCount}
          />
        )}
      </div>
    </Card>
  );
}

function SpikeBody({
  funded,
  target,
  targetDate,
  categoryColor,
  onTrack,
  expectedFundedByNow,
  paydaysRemaining,
  suggestedAllocation,
  onAllocate,
}: {
  funded: number;
  target: number;
  targetDate: string;
  categoryColor: string | null;
  onTrack?: "ahead" | "on_pace" | "behind";
  expectedFundedByNow?: number;
  paydaysRemaining?: number;
  suggestedAllocation?: number;
  onAllocate?: () => void;
}) {
  const pct = target > 0 ? Math.min(100, (funded / target) * 100) : 0;
  const expectedPct =
    expectedFundedByNow != null && target > 0
      ? Math.min(100, (expectedFundedByNow / target) * 100)
      : null;
  const isFullyFunded = funded >= target;

  return (
    <>
      <div className="flex items-end justify-between gap-2">
        <p className="text-lg font-bold tabular-nums leading-none">
          {fc(funded)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            / {fc(target)}
          </span>
        </p>
        {isFullyFunded ? (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-normal border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-400"
          >
            Funded
          </Badge>
        ) : (
          onTrack && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 font-normal ${ON_TRACK_STYLES[onTrack]}`}
            >
              {ON_TRACK_LABEL[onTrack]}
            </Badge>
          )
        )}
      </div>

      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: isFullyFunded
              ? "var(--color-success, #16a34a)"
              : categoryColor || "var(--color-primary)",
          }}
        />
        {!isFullyFunded && expectedPct != null && expectedPct > 0 && expectedPct <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-foreground/40"
            style={{ left: `${expectedPct}%` }}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {dayLabel(targetDate)}
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

      {onAllocate && (
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
      )}
    </>
  );
}

function PlainBody({
  netAmount,
  transactionCount,
}: {
  netAmount: number;
  transactionCount: number;
}) {
  return (
    <div>
      <p
        className={`text-lg font-bold tabular-nums leading-none ${
          netAmount === 0
            ? "text-foreground"
            : netAmount > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {netAmount >= 0 ? "+" : ""}
        {fc(netAmount)}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {transactionCount} transaction{transactionCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}
