import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth, withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logAuthEvent } from "@/lib/audit";
import { allowStepUpAttempt, grantStepUp, stepUpMethods } from "@/lib/step-up";

/**
 * POST /api/step-up/totp  { code, kind?: "totp" | "backup" }
 * Confirm a sensitive action with an authenticator code or a backup code.
 * Checked by better-auth against the user's own 2FA secret — in the current
 * session, so no cookie changes hands.
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    const meta = getRequestMeta(request.headers);
    if (!allowStepUpAttempt(ids.userId)) {
      return apiError("api.stepUpTooManyAttempts", 429);
    }
    const body = (await request.json().catch(() => null)) as { code?: unknown; kind?: unknown } | null;
    const kind = body?.kind === "backup" ? "backup" : "totp";
    const code = typeof body?.code === "string" ? body.code.replace(/\s/g, "") : "";
    const wellFormed = kind === "totp" ? /^\d{6}$/.test(code) : /^[A-Za-z0-9-]{4,64}$/.test(code);
    if (!wellFormed) return apiError("api.stepUpCodeInvalid", 400);

    if (!(await stepUpMethods(ids.userId)).totp) return apiError("api.stepUpNoTotp", 400);

    try {
      const requestHeaders = await headers();
      if (kind === "totp") {
        await auth.api.verifyTOTP({ body: { code }, headers: requestHeaders });
      } else {
        await auth.api.verifyBackupCode({ body: { code, disableSession: true }, headers: requestHeaders });
      }
    } catch {
      logAuthEvent({ userId: ids.userId, action: "step_up_failed", details: { method: kind }, ...meta });
      return apiError("api.stepUpCodeInvalid", 400);
    }

    const expiresAt = await grantStepUp(ids, kind === "totp" ? "totp" : "backup_code");
    logAuthEvent({ userId: ids.userId, action: "step_up_success", details: { method: kind }, ...meta });
    return NextResponse.json({ activeUntil: expiresAt });
  }, "Failed to verify step-up code");
}
