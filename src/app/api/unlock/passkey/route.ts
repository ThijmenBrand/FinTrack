import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logAuthEvent } from "@/lib/audit";
import { parseAssertion, verifyPasskeyAssertion } from "@/lib/passkey-assertion";
import { allowUnlockAttempt, unlockSession } from "@/lib/session-lock";

/**
 * POST /api/unlock/passkey  { response }
 * Unlock an idle-locked session with one of the user's own passkeys, user
 * verification required — the Face ID / Touch ID tap.
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    const meta = getRequestMeta(request.headers);
    if (!allowUnlockAttempt(ids.userId)) return apiError("api.stepUpTooManyAttempts", 429);

    const response = parseAssertion(await request.json().catch(() => null));
    if (!response) return apiError("api.stepUpPasskeyFailed", 400);

    const outcome = await verifyPasskeyAssertion(ids, response);
    if (outcome !== "verified") {
      if (outcome === "rejected") {
        logAuthEvent({ userId: ids.userId, action: "unlock_failed", details: { method: "passkey" }, ...meta });
      }
      return apiError("api.stepUpPasskeyFailed", 400);
    }

    await unlockSession(ids.sessionId, ids.userId);
    logAuthEvent({ userId: ids.userId, action: "unlock_success", details: { method: "passkey" }, ...meta });
    return NextResponse.json({ unlocked: true });
  }, "Failed to unlock with passkey");
}
