import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db } from "@/db";
import { passkey, stepUpChallenges } from "@/db/schema";
import { getBaseURL, withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logAuthEvent } from "@/lib/audit";
import { allowStepUpAttempt, grantStepUp } from "@/lib/step-up";

/**
 * POST /api/step-up/passkey/verify  { response }
 * Check the passkey assertion against the challenge this session was given:
 * right origin and RP, user verified, a passkey of THIS user, counter moved.
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    const meta = getRequestMeta(request.headers);
    if (!allowStepUpAttempt(ids.userId)) return apiError("api.stepUpTooManyAttempts", 429);

    const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
    const response = body?.response;
    if (!response || typeof response.id !== "string" || response.id.length > 1024) {
      return apiError("api.stepUpPasskeyFailed", 400);
    }

    // Take this session's newest live challenge and burn it, whatever happens next.
    const nowIso = new Date().toISOString();
    const [challenge] = await db
      .select()
      .from(stepUpChallenges)
      .where(
        and(
          eq(stepUpChallenges.userId, ids.userId),
          eq(stepUpChallenges.sessionId, ids.sessionId),
          isNull(stepUpChallenges.usedAt),
          gt(stepUpChallenges.expiresAt, nowIso),
        ),
      )
      .orderBy(desc(stepUpChallenges.createdAt))
      .limit(1);
    if (!challenge) return apiError("api.stepUpPasskeyFailed", 400);
    const burned = await db
      .update(stepUpChallenges)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(stepUpChallenges.id, challenge.id),
          eq(stepUpChallenges.userId, ids.userId),
          isNull(stepUpChallenges.usedAt),
        ),
      )
      .returning({ id: stepUpChallenges.id });
    if (burned.length === 0) return apiError("api.stepUpPasskeyFailed", 400);

    const [key] = await db
      .select()
      .from(passkey)
      .where(and(eq(passkey.credentialID, response.id), eq(passkey.userId, ids.userId)))
      .limit(1);
    if (!key) {
      logAuthEvent({ userId: ids.userId, action: "step_up_failed", details: { method: "passkey" }, ...meta });
      return apiError("api.stepUpPasskeyFailed", 400);
    }

    const base = new URL(getBaseURL());
    let verified: boolean;
    let newCounter = key.counter;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: base.origin,
        expectedRPID: base.hostname,
        requireUserVerification: true,
        credential: {
          id: key.credentialID,
          publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64")),
          counter: key.counter,
          transports: key.transports
            ? (key.transports.split(",") as AuthenticatorTransportFuture[])
            : undefined,
        },
      });
      verified = result.verified;
      newCounter = result.authenticationInfo.newCounter;
    } catch {
      verified = false;
    }
    if (!verified) {
      logAuthEvent({ userId: ids.userId, action: "step_up_failed", details: { method: "passkey" }, ...meta });
      return apiError("api.stepUpPasskeyFailed", 400);
    }

    await db
      .update(passkey)
      .set({ counter: newCounter })
      .where(and(eq(passkey.id, key.id), eq(passkey.userId, ids.userId)));
    const expiresAt = await grantStepUp(ids, "passkey");
    logAuthEvent({ userId: ids.userId, action: "step_up_success", details: { method: "passkey" }, ...meta });
    return NextResponse.json({ activeUntil: expiresAt });
  }, "Failed to verify passkey");
}
