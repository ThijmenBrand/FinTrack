import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { passkey, stepUpGrants, twoFactor, user } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { withSession, withAdminSession, type SessionIds } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Step-up ("sudo mode"): sensitive actions need a fresh second factor — a
 * TOTP code, a backup code or a passkey with user verification — given in
 * THIS session within the last five minutes.
 *
 * Deliberately not "sign in again": better-auth's password sign-in for a 2FA
 * user drops the current session cookie before the code is asked, so cancelling
 * the dialog would log the user out; and a fresh session alone doesn't prove a
 * second factor. A grant here is only ever written after one was checked.
 *
 * A password alone never unlocks these actions. A user with neither 2FA nor a
 * passkey can't use them until they add one.
 */

export const STEP_UP_TTL_MS = 5 * 60_000;

export interface StepUpMethods {
  totp: boolean;
  passkey: boolean;
}

/** Which second factors this user can step up with. */
export async function stepUpMethods(userId: string): Promise<StepUpMethods> {
  const [u] = await db
    .select({ twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  // A TOTP row that was never verified is a half-finished setup — verifying a
  // code against it would *enable* 2FA as a side effect (better-auth's
  // verify-totp does that), so it doesn't count.
  const [tf] = await db
    .select({ verified: twoFactor.verified })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .limit(1);
  const [pk] = await db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .limit(1);
  return {
    totp: u?.twoFactorEnabled === true && tf?.verified === true,
    passkey: !!pk,
  };
}

/** When this session's step-up runs out, or null if it has none. */
export async function activeStepUp(ids: SessionIds): Promise<string | null> {
  const [grant] = await db
    .select({ expiresAt: stepUpGrants.expiresAt })
    .from(stepUpGrants)
    .where(
      and(
        eq(stepUpGrants.userId, ids.userId),
        eq(stepUpGrants.sessionId, ids.sessionId),
        gt(stepUpGrants.expiresAt, new Date().toISOString()),
      ),
    )
    .orderBy(stepUpGrants.expiresAt)
    .limit(1);
  return grant?.expiresAt ?? null;
}

export async function grantStepUp(
  ids: SessionIds,
  method: "totp" | "backup_code" | "passkey",
): Promise<string> {
  const now = Date.now();
  const expiresAt = new Date(now + STEP_UP_TTL_MS).toISOString();
  // Expired grants are worthless; keep the table small.
  await db
    .delete(stepUpGrants)
    .where(and(eq(stepUpGrants.userId, ids.userId), lt(stepUpGrants.expiresAt, new Date(now).toISOString())));
  await db.insert(stepUpGrants).values({
    userId: ids.userId,
    sessionId: ids.sessionId,
    method,
    expiresAt,
    createdAt: new Date(now).toISOString(),
  });
  return expiresAt;
}

async function requireStepUp(ids: SessionIds): Promise<void> {
  if (await activeStepUp(ids)) return;
  // `code` is what the client keys off to open the "Confirm it's you" dialog.
  throw await apiError("api.stepUpRequired", 403, undefined, { code: "step_up_required" });
}

/** withSession + a fresh second factor in this session. */
export function withStepUp(
  handler: (ids: SessionIds) => Promise<Response> | Response,
  errorMessage: string,
): Promise<Response> {
  return withSession(async (ids) => {
    await requireStepUp(ids);
    return handler(ids);
  }, errorMessage);
}

/** Admin variant: the backoffice's sensitive actions (DLQ replay/discard). */
export function withAdminStepUp(
  handler: (ids: SessionIds) => Promise<Response> | Response,
  errorMessage: string,
): Promise<Response> {
  return withAdminSession(async (ids) => {
    await requireStepUp(ids);
    return handler(ids);
  }, errorMessage);
}

/**
 * Attempts per user per five minutes, across all step-up methods. Calling
 * better-auth's verify endpoints from the server skips its own HTTP rate
 * limiter, so this is the brake on guessing a 6-digit code.
 */
export const allowStepUpAttempt = createRateLimiter(STEP_UP_TTL_MS, 10);
