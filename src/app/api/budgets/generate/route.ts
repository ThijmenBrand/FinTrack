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

    const suggestions = await regenerateBudgetSuggestions(
      userId,
      prefs.autoBudgetLookbackMonths,
      plan,
    );
    await markAutoBudgetChecked(userId);
    logDataEvent({
      userId,
      action: "budget_generate",
      targetType: "budget",
      details: {
        count: suggestions.length,
        lookbackMonths: prefs.autoBudgetLookbackMonths,
        budgetId: plan?.id ?? null,
      },
    });
    const emptyReason =
      suggestions.length === 0
        ? await explainEmptyGenerate(userId, prefs.autoBudgetLookbackMonths, plan)
        : null;
    return NextResponse.json({ suggestions, emptyReason });
  }, "Failed to generate budget suggestions");
}
