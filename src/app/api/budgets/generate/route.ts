import { NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { regenerateBudgetSuggestions } from "@/lib/auto-budget";
import { getUserPreferences, markAutoBudgetChecked } from "@/lib/preferences";

export async function POST() {
  return withUser(async (userId) => {
    const prefs = await getUserPreferences(userId);
    const suggestions = await regenerateBudgetSuggestions(userId, prefs.autoBudgetLookbackMonths);
    await markAutoBudgetChecked(userId);
    logDataEvent({
      userId,
      action: "budget_generate",
      targetType: "budget",
      details: { count: suggestions.length, lookbackMonths: prefs.autoBudgetLookbackMonths },
    });
    return NextResponse.json({ suggestions });
  }, "Failed to generate budget suggestions");
}
