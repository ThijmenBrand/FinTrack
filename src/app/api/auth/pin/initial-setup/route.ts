import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { auth, hashPassword } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { validateCsrfOrigin } from "@/lib/csrf";
import { validatePin } from "@/lib/pin-utils";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";

// POST: Initial PIN setup after first login (requires session, no password needed)
// Only works if user does NOT already have a PIN set.
export async function POST(req: NextRequest) {
  try {
    const csrfError = validateCsrfOrigin(req);
    if (csrfError) return csrfError;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return apiError("api.unauthorized", 401);
    }

    const body = await req.json();
    const { pin } = body;

    if (!pin) {
      return apiError("api.pinRequired", 400);
    }

    const pinError = validatePin(pin);
    if (pinError) {
      return NextResponse.json({ error: pinError }, { status: 400 });
    }

    // Only allow if user has no existing PIN
    const existing = await db
      .select()
      .from(userPin)
      .where(eq(userPin.userId, session.user.id))
      .get();

    if (existing) {
      return apiError("api.pinAlreadySet", 409);
    }

    const pinHash = await hashPassword(pin);

    await db.insert(userPin).values({
      userId: session.user.id,
      pinHash,
    });

    const { ipAddress, userAgent } = getRequestMeta(req.headers);
    logAuthEvent({
      userId: session.user.id,
      action: "pin_initial_setup",
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch {
    return apiError("api.serverError", 500);
  }
}
