"use client";

import type { BudgetData, InsightsData } from "@/types/api";
import { formatCurrency } from "@/lib/utils";

const TONES = {
  red: {
    border: "border-red-300 dark:border-red-900/60",
    title: "text-red-600 dark:text-red-400",
  },
  amber: {
    border: "border-amber-300 dark:border-amber-900/60",
    title: "text-amber-600 dark:text-amber-400",
  },
  accent: {
    border: "border-border",
    title: "text-foreground",
  },
} as const;

interface Signal {
  key: string;
  tone: keyof typeof TONES;
  title: string;
  detail: string;
  onClick?: () => void;
}

/** The share of expenses that has to sit in the top few lines to be worth saying. */
const CONCENTRATION_THRESHOLD = 0.33;
const CONCENTRATION_MAX_ITEMS = 5;
/** A category counts as "new" when the previous period was under this fraction of it. */
const NEW_CATEGORY_RATIO = 0.1;

function daysLeft(toDate: string): number {
  const ms = new Date(toDate + "T23:59:59").getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}

interface SignalCardsProps {
  data: InsightsData;
  /** Null outside single financial months — budget caps don't apply there. */
  budget: BudgetData | null;
  totalExpenses: number;
  onCategoryClick: (categoryId: string | null) => void;
}

/**
 * The row of "what actually needs your attention" cards above the charts.
 * Every signal is derived from data already on the page; a signal that doesn't
 * apply isn't rendered, and the whole row disappears when none do.
 */
export function SignalCards({
  data,
  budget,
  totalExpenses,
  onCategoryClick,
}: SignalCardsProps) {
  const signals: Signal[] = [];

  // 1. Where the total budget stands, and how much runway is left.
  if (budget && budget.totalBudget > 0) {
    const pct = Math.round((budget.totalSpentThisMonth / budget.totalBudget) * 100);
    const diff = budget.totalSpentThisMonth - budget.totalBudget;
    const left = daysLeft(budget.month.to);
    const leftLabel = left > 0 ? `, ${left} day${left === 1 ? "" : "s"} left` : "";
    signals.push({
      key: "budget",
      tone: pct >= 100 ? "red" : pct >= 80 ? "amber" : "accent",
      title: `${pct}% of budget spent`,
      detail:
        diff > 0
          ? `${formatCurrency(diff)} over${leftLabel}`
          : `${formatCurrency(-diff)} left${leftLabel}`,
    });
  }

  // 2. The biggest pile of spending nothing is tracking.
  const topUnbudgeted = budget?.unbudgetedSpending
    .slice()
    .sort((a, b) => b.spent - a.spent)[0];
  if (topUnbudgeted) {
    const txCount = data.categoryBreakdown.find(
      (c) => c.categoryId === topUnbudgeted.categoryId,
    )?.count;
    signals.push({
      key: "unbudgeted",
      tone: "amber",
      title: `${topUnbudgeted.categoryName} has no budget`,
      detail: `${formatCurrency(topUnbudgeted.spent)} untracked${txCount ? ` · ${txCount} tx` : ""}`,
      onClick: () => onCategoryClick(topUnbudgeted.categoryId),
    });
  }

  // 3. A category that barely existed last period and now does.
  if (data.previous) {
    const prev = data.previous.categoryTotals;
    const fresh = data.categoryBreakdown
      .filter((c) => c.total > 0 && (prev[c.categoryId ?? "none"] ?? 0) < c.total * NEW_CATEGORY_RATIO)
      .sort((a, b) => b.total - a.total)[0];
    if (fresh) {
      signals.push({
        key: "new",
        tone: "amber",
        title: "New this month",
        detail: `${fresh.categoryName} · +${formatCurrency(fresh.total)}`,
        onClick: () => onCategoryClick(fresh.categoryId),
      });
    }
  }

  // 4. Concentration: how few lines account for a third of everything.
  if (totalExpenses > 0) {
    let running = 0;
    let count = 0;
    for (const m of data.topMerchants.slice(0, CONCENTRATION_MAX_ITEMS)) {
      running += m.total;
      count++;
      if (running / totalExpenses >= CONCENTRATION_THRESHOLD) break;
    }
    if (count > 0 && running / totalExpenses >= CONCENTRATION_THRESHOLD) {
      const singles = data.topMerchants
        .slice(0, count)
        .every((m) => m.count === 1);
      const noun = singles ? "purchases" : "merchants";
      signals.push({
        key: "concentration",
        tone: "accent",
        title: `${count} ${noun} = ${Math.round((running / totalExpenses) * 100)}% of spend`,
        detail: `${formatCurrency(running)} in the top ${count}`,
      });
    }
  }

  if (signals.length === 0) return null;

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {signals.map((s) => {
        const tone = TONES[s.tone];
        const body = (
          <>
            <div className={`text-xs font-semibold ${tone.title}`}>{s.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {s.detail}
            </div>
          </>
        );
        const className = `rounded-lg border px-3.5 py-2.5 ${tone.border}`;
        return s.onClick ? (
          <button
            key={s.key}
            type="button"
            onClick={s.onClick}
            className={`${className} text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            {body}
          </button>
        ) : (
          <div key={s.key} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
