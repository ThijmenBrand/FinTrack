import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getUserPreferences, updateUserPreferences } from "@/lib/preferences";

export async function GET() {
  try {
    const userId = await getUserId();
    const prefs = await getUserPreferences(userId);
    return NextResponse.json(prefs);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to fetch preferences:", error);
    return NextResponse.json({ error: "Failed to fetch preferences" }, { status: 500 });
  }
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body?.autoBudgetEnabled === "boolean") patch.autoBudgetEnabled = body.autoBudgetEnabled;
    if (isFiniteNumber(body?.autoBudgetIntervalMonths)) patch.autoBudgetIntervalMonths = body.autoBudgetIntervalMonths;
    if (isFiniteNumber(body?.autoBudgetLookbackMonths)) patch.autoBudgetLookbackMonths = body.autoBudgetLookbackMonths;
    const prefs = await updateUserPreferences(userId, patch);
    return NextResponse.json(prefs);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to update preferences:", error);
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }
}
