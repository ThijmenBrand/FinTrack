import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { db } from "@/db";
import { passkey, stepUpChallenges } from "@/db/schema";
import { getBaseURL, type SessionIds } from "@/lib/auth";

/**
 * "Prove it's you with a passkey" inside an existing session — used by step-up
 * and by the idle-lock screen. Unlike better-auth's passkey sign-in, this
 * creates no session: it only answers whether THIS session's user just passed
 * user verification (biometrics / PIN) on one of their own passkeys.
 */

const CHALLENGE_TTL_MS = 2 * 60_000;

function transports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  return value ? (value.split(",") as AuthenticatorTransportFuture[]) : undefined;
}

/**
 * A WebAuthn challenge offering only this user's own passkeys, with user
 * verification required. Single use and bound to this session. Null when the
 * user has no passkey.
 */
export async function createPasskeyChallenge(
  ids: SessionIds,
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const keys = await db
    .select({ credentialID: passkey.credentialID, transports: passkey.transports })
    .from(passkey)
    .where(eq(passkey.userId, ids.userId));
  if (keys.length === 0) return null;

  const options = await generateAuthenticationOptions({
    rpID: new URL(getBaseURL()).hostname,
    userVerification: "required",
    timeout: 60_000,
    allowCredentials: keys.map((k) => ({ id: k.credentialID, transports: transports(k.transports) })),
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
  return options;
}

/** Shape check before anything touches the database. */
export function parseAssertion(body: unknown): AuthenticationResponseJSON | null {
  const response = (body as { response?: AuthenticationResponseJSON } | null)?.response;
  if (!response || typeof response.id !== "string" || response.id.length > 1024) return null;
  return response;
}

/**
 * Check an assertion against the challenge this session was given: right
 * origin and RP, user verified, a passkey of THIS user, counter moved.
 *
 * `"no-challenge"` means there was nothing to check it against (expired,
 * already used); `"rejected"` means a real attempt that failed — the one
 * worth an audit entry.
 */
export async function verifyPasskeyAssertion(
  ids: SessionIds,
  response: AuthenticationResponseJSON,
): Promise<"verified" | "no-challenge" | "rejected"> {
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
  if (!challenge) return "no-challenge";
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
  if (burned.length === 0) return "no-challenge";

  const [key] = await db
    .select()
    .from(passkey)
    .where(and(eq(passkey.credentialID, response.id), eq(passkey.userId, ids.userId)))
    .limit(1);
  if (!key) return "rejected";

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
        transports: transports(key.transports),
      },
    });
    verified = result.verified;
    newCounter = result.authenticationInfo.newCounter;
  } catch {
    verified = false;
  }
  if (!verified) return "rejected";

  await db
    .update(passkey)
    .set({ counter: newCounter })
    .where(and(eq(passkey.id, key.id), eq(passkey.userId, ids.userId)));
  return "verified";
}
