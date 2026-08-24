"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { toMonthly } from "@/lib/recurring";
import type { RecurringTx } from "@/types/api";
import { Plus } from "lucide-react";
import { cents } from "./constants";

/**
 * The recurring plans running in this category that the tree doesn't stand
 * for yet, offered one click at a time.
 *
 * The add dialog seeds these into its draft when a category is picked (see
 * `seededFor` there) — a plan spends against the cap whether the tree names it
 * or not, so "leave it out" was never a real answer. This list is what is left:
 * re-adopting one that was removed, and the edit dialog, where a hand-typed
 * amount already exists and folding plans in on open would re-sum it without
 * being asked.
 *
 * An adopted plan drops out of the list entirely rather than lingering as a
 * disabled "Added" row — it is already standing in the breakdown above, with
 * the same name and the same amount, and saying it twice reads as two bills.
 */
export function AdoptList({
  plans,
  adoptedIds,
  toDisplay,
  onAdopt,
}: {
  plans: RecurringTx[];
  /** Plans already standing in the tree — nothing left to offer for those. */
  adoptedIds: Set<string>;
  toDisplay: (stored: number) => number;
  onAdopt: (plan: RecurringTx) => void;
}) {
  const { t, formatCurrency } = useI18n();
  const offered = plans.filter((p) => !adoptedIds.has(p.id));
  if (offered.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        {t("budgets.subLines.adoptHeading")}
      </p>
      {offered.map((plan) => (
        <div
          key={plan.id}
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/50"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{plan.description}</span>
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatCurrency(cents(toDisplay(toMonthly(plan.amount, plan.frequency))))}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => onAdopt(plan)}
          >
            <Plus className="mr-1 h-3 w-3" />
            {t("budgets.subLines.adopt")}
          </Button>
        </div>
      ))}
    </div>
  );
}
