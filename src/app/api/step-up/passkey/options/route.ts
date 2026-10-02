import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db } from "@/db";
import { passkey, stepUpChallenges } from "@/db/schema";
import { getBaseURL, withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";

const CHALLENGE_TTL_MS = 2 * 60_000;

/**
 * POST /api/step-up/passkey/options
 * A WebAuthn challenge for confirming with a passkey — only this user's own
 * passkeys are offered, and user verification (biometrics / PIN) is required.
 * The challenge is single use and bound to this session.
 */
export async function POST() {
  return withSession(async (ids) => {
    const keys = await db
      .select({ credentialID: passkey.credentialID, transports: passkey.transports })
      .from(passkey)
      .where(eq(passkey.userId, ids.userId));
    if (keys.length === 0) return apiError("api.stepUpNoPasskey", 400);

    const options = await generateAuthenticationOptions({
      rpID: new URL(getBaseURL()).hostname,
      userVerification: "required",
      timeout: 60_000,
      allowCredentials: keys.map((k) => ({
        id: k.credentialID,
        transports: k.transports
          ? (k.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      })),
    });

    const now = Date.now();
    await db
      .delete(stepUpChallenges)
      .where(and(eq(stepUpChallenges.userId, ids.userId), lt(stepUpChallenges.expiresAt, new Date(now).toISOString())));
    await db.insert(stepUpChallenges).values({
      userId: ids.userId,
      sessionId: ids.sessionId,
      challenge: options.challenge,
      expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    });
    return NextResponse.json(options);
  }, "Failed to create passkey challenge");
}
