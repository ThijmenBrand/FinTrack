import { NextResponse } from "next/server";
import { withSession } from "@/lib/auth";
import { activeStepUp, stepUpMethods } from "@/lib/step-up";

/**
 * GET /api/step-up
 * Which second factors this user can confirm with, and whether this session
 * already has a fresh confirmation (and until when).
 */
export async function GET() {
  return withSession(async (ids) => {
    const [methods, activeUntil] = await Promise.all([stepUpMethods(ids.userId), activeStepUp(ids)]);
    return NextResponse.json({ methods, activeUntil });
  }, "Failed to read step-up status");
}
