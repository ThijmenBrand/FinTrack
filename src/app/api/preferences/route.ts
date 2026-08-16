import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { getUserPreferences, updateUserPreferences } from "@/lib/preferences";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isLocale } from "@/lib/i18n";
import { resolveBudgetPlan } from "@/lib/budget-plan";

export async function GET() {
  return withUser(async (userId) => {
    const prefs = await getUserPreferences(userId);
    return NextResponse.json(prefs);
  }, "Failed to fetch preferences");
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body?.autoBudgetEnabled === "boolean") patch.autoBudgetEnabled = body.autoBudgetEnabled;
    if (typeof body?.hideInternalTransfers === "boolean") patch.hideInternalTransfers = body.hideInternalTransfers;
    if (typeof body?.countCrossBudgetTransfers === "boolean") patch.countCrossBudgetTransfers = body.countCrossBudgetTransfers;
    if (typeof body?.simpleMode === "boolean") patch.simpleMode = body.simpleMode;
    if (isFiniteNumber(body?.autoBudgetIntervalMonths)) patch.autoBudgetIntervalMonths = body.autoBudgetIntervalMonths;
    if (isFiniteNumber(body?.autoBudgetLookbackMonths)) patch.autoBudgetLookbackMonths = body.autoBudgetLookbackMonths;
    if (isFiniteNumber(body?.financialMonthStartDay)) patch.financialMonthStartDay = body.financialMonthStartDay;
    if (isLocale(body?.locale)) patch.locale = body.locale;
    if ("defaultAccountId" in (body ?? {})) {
      const raw = body.defaultAccountId;
      if (raw === null || raw === "") {
        patch.defaultAccountId = null;
      } else if (typeof raw === "string") {
        const owned = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, raw), eq(accounts.userId, userId)))
          .limit(1);
        if (owned.length === 0) {
          return NextResponse.json({ error: "Invalid defaultAccountId" }, { status: 400 });
        }
        patch.defaultAccountId = raw;
      }
    }
    if ("mainBudgetPlanId" in (body ?? {})) {
      const raw = body.mainBudgetPlanId;
      if (raw === null || raw === "") {
        patch.mainBudgetPlanId = null;
      } else if (typeof raw === "string") {
        // Accessible = own plan, or a plan with ≥1 account shared with the user.
        const plan = await resolveBudgetPlan(userId, raw);
        if (!plan) {
          return NextResponse.json({ error: "Invalid mainBudgetPlanId" }, { status: 400 });
        }
        patch.mainBudgetPlanId = raw;
      }
    }
    const prefs = await updateUserPreferences(userId, patch);
    return NextResponse.json(prefs);
  }, "Failed to update preferences");
}
