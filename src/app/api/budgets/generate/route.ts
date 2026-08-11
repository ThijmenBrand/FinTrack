import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { explainEmptyGenerate, regenerateBudgetSuggestions } from "@/lib/auto-budget";
import { getUserPreferences, markAutoBudgetChecked } from "@/lib/preferences";
import { resolveBudgetPlan } from "@/lib/budget-plan";

export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => ({}));
    const budgetId = typeof body?.budgetId === "string" ? body.budgetId : null;

    const [prefs, plan] = await Promise.all([
      getUserPreferences(userId),
      resolveBudgetPlan(userId, budgetId),
    ]);
    if (budgetId && !plan) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    // A yearly plan is budgeting a whole year, so it looks back a whole year:
    // insurance, road tax and other once-a-year costs never appear in a
    // three-month window, and a plan that ignores them budgets for a fiction.
    const lookbackMonths =
      plan?.period === "yearly" ? 12 : prefs.autoBudgetLookbackMonths;

    const suggestions = await regenerateBudgetSuggestions(
      userId,
      lookbackMonths,
      plan,
    );
    await markAutoBudgetChecked(userId);
    logDataEvent({
      userId,
      action: "budget_generate",
      targetType: "budget",
      details: {
        count: suggestions.length,
        lookbackMonths,
        budgetId: plan?.id ?? null,
      },
    });
    const emptyReason =
      suggestions.length === 0
        ? await explainEmptyGenerate(userId, lookbackMonths, plan)
        : null;
    return NextResponse.json({ suggestions, emptyReason });
  }, "Failed to generate budget suggestions");
}
