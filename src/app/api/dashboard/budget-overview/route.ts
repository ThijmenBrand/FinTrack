import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { getBudgetOverview } from "@/app/(app)/_lib/dashboard-queries";

/**
 * GET /api/dashboard/budget-overview?budgetId= — the dashboard budget card's
 * data for one plan. Backs the card's in-card budget switcher; the initial
 * (main plan) render is served by the RSC page itself.
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const budgetId = new URL(request.url).searchParams.get("budgetId");
    if (!budgetId) {
      return NextResponse.json({ error: "budgetId is required" }, { status: 400 });
    }
    const prefs = await getUserPreferences(userId);
    const data = await getBudgetOverview(
      userId,
      prefs.financialMonthStartDay,
      budgetId,
    );
    if (!data.plan) {
      return apiError("api.budgetNotFound", 404);
    }
    return NextResponse.json(data);
  }, "Failed to fetch budget overview");
}
