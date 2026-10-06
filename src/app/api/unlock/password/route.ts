import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { verifyPassword, withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logAuthEvent } from "@/lib/audit";
import {
  allowUnlockAttempt,
  readLockState,
  recordUnlockFailure,
  unlockMethods,
  unlockSession,
} from "@/lib/session-lock";

/**
 * POST /api/unlock/password  { password }
 * Unlock an idle-locked session with the account password — for users without
 * a passkey. The cookie is the "something you have"; the password the "something
 * you know". Every wrong password counts against the session, and at the limit
 * the session is signed out (recordUnlockFailure).
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    const meta = getRequestMeta(request.headers);

    // Nothing to unlock — and a wrong password here must not start counting
    // against a session that is in use.
    if (!(await readLockState(ids.sessionId)).locked) {
      return NextResponse.json({ unlocked: true });
    }
    if (!allowUnlockAttempt(ids.userId)) return apiError("api.stepUpTooManyAttempts", 429);

    const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password || password.length > 1024) return apiError("api.unlockPasswordWrong", 400);

    if (!(await unlockMethods(ids.userId)).password) {
      return apiError("api.unlockPasswordUnavailable", 403);
    }

    const [credential] = await db
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, ids.userId), eq(account.providerId, "credential")))
      .limit(1);
    const valid = !!credential?.password && (await verifyPassword(password, credential.password));

    if (!valid) {
      const left = await recordUnlockFailure(ids.sessionId, ids.userId);
      logAuthEvent({ userId: ids.userId, action: "unlock_failed", details: { method: "password", attemptsLeft: left }, ...meta });
      if (left === 0) {
        return apiError("api.unlockSignedOut", 401, undefined, { code: "signed_out" });
      }
      return apiError(
        left === 1 ? "api.unlockPasswordWrongLast" : "api.unlockPasswordWrongLeft",
        400,
        { count: left },
      );
    }

    await unlockSession(ids.sessionId, ids.userId);
    logAuthEvent({ userId: ids.userId, action: "unlock_success", details: { method: "password" }, ...meta });
    return NextResponse.json({ unlocked: true });
  }, "Failed to unlock with password");
}
