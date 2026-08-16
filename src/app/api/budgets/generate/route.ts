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

    const plan = await resolveBudgetPlan(userId, budgetId);
    if (budgetId && !plan) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }
    // Viewers on a shared plan are read-only; editors may regenerate
    // suggestions same as the owner.
    if (plan && plan.role === "viewer") {
      return NextResponse.json({ error: "Read-only access" }, { status: 403 });
    }
    // Suggestions are plan-owned data: run as the OWNER (own plans:
    // dataUserId === userId), so the rows, the automation cadence and the
    // owner's lookback preference all live in one user's space regardless of
    // which member triggered the regeneration.
    const dataUserId = plan?.ownerId ?? userId;
    const prefs = await getUserPreferences(dataUserId);

    // A yearly plan is budgeting a whole year, so it looks back a whole year:
    // insurance, road tax and other once-a-year costs never appear in a
    // three-month window, and a plan that ignores them budgets for a fiction.
    const lookbackMonths =
      plan?.period === "yearly" ? 12 : prefs.autoBudgetLookbackMonths;

    const suggestions = await regenerateBudgetSuggestions(
      dataUserId,
      lookbackMonths,
      plan,
    );
    await markAutoBudgetChecked(dataUserId);
    logDataEvent({
      userId,
      action: "budget_generate",
      targetType: "budget",
      details: {
        count: suggestions.length,
        lookbackMonths,
        budgetId: plan?.id ?? null,
        ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}),
      },
    });
    const emptyReason =
      suggestions.length === 0
        ? await explainEmptyGenerate(dataUserId, lookbackMonths, plan)
        : null;
    return NextResponse.json({ suggestions, emptyReason });
  }, "Failed to generate budget suggestions");
}
