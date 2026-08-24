"use client";

import { AlertTriangle, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import type { SplitShare } from "@/lib/budget-split";
import { useI18n } from "@/lib/i18n/client";
import { SectionHeader } from "./section-header";

/**
 * One colour per person, for the proportion bar and the face beside their
 * name. Deliberately off the state palette — emerald, amber and red mean
 * income, attention and overspend everywhere else in this app, and a
 * housemate is none of those things.
 */
const PERSON_COLORS = ["#3b82f6", "#a855f7", "#06b6d4", "#ec4899", "#f97316"];

/** Same column track as the per-row split under every category. */
const GRID =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem_6rem] items-center gap-x-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_2.75rem_6rem_6rem]";

/**
 * The whole split of a shared budget in one place: what each person carries
 * this period, as a bar, a percentage and the euros they actually owe.
 *
 * The category rows below each carry their own split behind the chevron —
 * useful for settling one bill, useless for the question this section answers,
 * which is what one person owes for the month in total. Both are the same key
 * read at different heights, so they use the same columns and the same order.
 */
export function SplitSummary({
  shares,
  /** What the period costs in full — every share is a slice of this. */
  total,
  /** What has actually gone out of it so far, split the same way. */
  spent,
}: {
  shares: SplitShare[];
  total: number;
  spent: number;
}) {
  const { t, formatCurrency } = useI18n();
  if (shares.length === 0) return null;

  // Fixed amounts that between them ask for more than the budget holds. The
  // euros stay honest (whoever is on the rest carries nothing rather than a
  // negative), so the gap is reported here in words instead.
  const assigned = shares.reduce((sum, share) => sum + share.amount, 0);
  const over = assigned - total;

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y">
        <SectionHeader
          icon={Users}
          label={t("budgets.split.heading", { count: shares.length })}
          note={t("budgets.split.toDivide", { amount: formatCurrency(total) })}
        />

        <li className="px-4 pb-4 pt-3">
          {/* The split as one length before it is a table of numbers: two
              people at 60/40 is a thing you see, not a thing you compare. The
              hairline gaps come from the track showing through. */}
          <div
            className="flex h-2 gap-px overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={shares
              .map((s) => `${s.name} ${Math.round(s.percent)}%`)
              .join(", ")}
          >
            {shares.map((share, i) => (
              <div
                key={share.name}
                className="h-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(0, share.percent)}%`,
                  backgroundColor: PERSON_COLORS[i % PERSON_COLORS.length],
                }}
              />
            ))}
          </div>

          <div className="mt-4 space-y-2.5">
            <div
              className={`${GRID} text-[10px] uppercase tracking-wider text-muted-foreground`}
            >
              <span />
              <span />
              <span />
              <span className="text-right">{t("budgets.split.colOwes")}</span>
              <span className="hidden text-right sm:block">
                {t("budgets.split.colSpent")}
              </span>
            </div>

            {shares.map((share, i) => (
              <div key={share.name} className={GRID}>
                {/* The ring ties the face to its length in the bar above, so
                    the bar needs no legend of its own. */}
                <span
                  className="inline-flex rounded-full"
                  style={{
                    boxShadow: `0 0 0 2px ${PERSON_COLORS[i % PERSON_COLORS.length]}`,
                  }}
                >
                  <UserAvatar
                    name={share.name}
                    image={share.image}
                    className="h-6 w-6 text-[11px]"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm" title={share.name}>
                    {share.name}
                  </span>
                  {/* Why their figure moves when the budget does. */}
                  {share.rest && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t("budgets.split.coversRest")}
                    </span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(share.percent)}%
                </span>
                <span className="text-right text-sm font-medium tabular-nums">
                  {formatCurrency(share.amount)}
                </span>
                <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {formatCurrency((spent * share.percent) / 100)}
                </span>
              </div>
            ))}
          </div>

          {over > 0.01 && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {t("budgets.split.overFixed", {
                fixed: formatCurrency(assigned),
                total: formatCurrency(total),
              })}
            </p>
          )}
        </li>
      </ul>
    </Card>
  );
}
