import { loadBudgetOverview } from "@/lib/budget-overview";
import { draft, type Draft } from "../dispatch";
import type { Evaluator } from "./types";

/**
 * When a budget line is worth a message.
 *
 * Pace: a straight-line projection of this month's spending, but only once
 * the month is a fifth gone and half the budget is spent — before that one
 * big shop reads as a disaster. Late in the month the projection only trips
 * once the line is already over, so "pace" hands over to "over" by itself.
 */
export const PACE_RULES = {
  minProgress: 0.2,
  minSpentShare: 0.5,
  projectedOverShare: 1.2,
} as const;

const EPSILON = 0.005;

export type BudgetLineVerdict = { kind: "over" } | { kind: "pace"; projected: number } | null;

export function classifyBudgetLine(line: { spent: number; limit: number; progress: number }): BudgetLineVerdict {
  const { spent, limit, progress } = line;
  // A zero cap is "don't plan for this", not a budget to warn about.
  if (!(limit > 0)) return null;
  if (spent > limit + EPSILON) return { kind: "over" };
  if (progress < PACE_RULES.minProgress || spent < limit * PACE_RULES.minSpentShare) return null;
  const projected = spent / Math.min(progress, 1);
  if (projected >= limit * PACE_RULES.projectedOverShare) return { kind: "pace", projected: Math.round(projected) };
  return null;
}

/**
 * The user's main budget plan, line by line, exactly as the dashboard card
 * computes it. Lines that stand for recurring bills are skipped: those are
 * lumpy by nature, and a price change is not overspending.
 */
export const budgetEvaluator: Evaluator = {
  types: ["budget.over", "budget.pace"],
  async run(ctx) {
    const overview = await loadBudgetOverview(ctx.userId, ctx.startDay, undefined, ctx.i18n.t("dashboard.intoPots"));
    const planKey = overview.plan?.id ?? "none";
    const fixed = new Set(overview.fixedCostCategoryIds);
    const drafts: Draft[] = [];
    for (const line of overview.budgetItems) {
      if (fixed.has(line.categoryId)) continue;
      const verdict = classifyBudgetLine({ spent: line.spent, limit: line.limit, progress: overview.monthProgress });
      if (!verdict) continue;
      const data = {
        planId: overview.plan?.id ?? null,
        categoryId: line.categoryId,
        categoryName: line.categoryName ?? "",
        spent: line.spent,
        limit: line.limit,
        monthStart: overview.monthStart,
      };
      const scope = `${planKey}:${line.categoryId}:${overview.monthStart}`;
      if (verdict.kind === "over" && ctx.wants("budget.over")) {
        drafts.push(draft("budget.over", data, `budget.over:${scope}`));
      } else if (verdict.kind === "pace" && ctx.wants("budget.pace")) {
        drafts.push(draft("budget.pace", { ...data, projected: verdict.projected }, `budget.pace:${scope}`));
      }
    }
    return drafts;
  },
};
