"use client";

import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Simple mode's stand-in for the stat strip: one emoji, one big number, one
 * fat bar. Where the full view explains the plan, this one just says how the
 * month is going and tries to make it feel good.
 */
const MOODS = [
  {
    upTo: 0.5,
    emoji: "🌱",
    bar: "from-emerald-400 to-teal-400",
    line: "budgets.simple.mood.great",
  },
  {
    upTo: 0.8,
    emoji: "😎",
    bar: "from-lime-400 to-emerald-400",
    line: "budgets.simple.mood.good",
  },
  {
    upTo: 1,
    emoji: "😬",
    bar: "from-amber-400 to-orange-400",
    line: "budgets.simple.mood.tight",
  },
  {
    upTo: Infinity,
    emoji: "🙈",
    bar: "from-rose-400 to-red-500",
    line: "budgets.simple.mood.over",
  },
] satisfies { upTo: number; emoji: string; bar: string; line: MessageKey }[];

/** Spent/limit ratio → mood. Over-budget is the catch-all. */
export function moodFor(ratio: number) {
  return MOODS.find((m) => ratio <= m.upTo) ?? MOODS[MOODS.length - 1];
}

export function SimpleHero({
  spent,
  limit,
  daysLeft,
}: {
  spent: number;
  limit: number;
  /** Null for past months — no countdown to give. */
  daysLeft: number | null;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const ratio = limit > 0 ? spent / limit : 0;
  const mood = moodFor(ratio);
  const left = limit - spent;

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-muted/40 p-4 sm:gap-5 sm:p-5">
      <span
        className="text-4xl transition-transform duration-300 hover:-rotate-6 hover:scale-125 sm:text-5xl"
        aria-hidden="true"
      >
        {mood.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-bold tabular-nums sm:text-3xl">
          {formatCurrency(Math.abs(left))}{" "}
          <span className="text-sm font-medium text-muted-foreground">
            {left >= 0 ? t("budgets.simple.left") : t("budgets.simple.over")}
          </span>
        </p>
        <div className="mt-2.5 h-3 overflow-hidden rounded-full bg-background">
          <div
            className={`h-full rounded-full bg-linear-to-r ${mood.bar} transition-[width] duration-700 ease-out`}
            style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.round(limit)}
            aria-valuenow={Math.round(spent)}
            aria-label={t("budgets.allocationsSpent", {
              spent: formatCurrency(spent),
              limit: formatCurrency(limit),
            })}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t(mood.line)}
          {daysLeft !== null && (
            <>
              {" · "}
              {plural(
                daysLeft,
                "budgets.simple.daysLeft.one",
                "budgets.simple.daysLeft.other",
              )}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
