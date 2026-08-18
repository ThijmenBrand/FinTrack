import { NextRequest, NextResponse } from "next/server";
import { apiError, requestI18n } from "@/lib/api-errors";
import { auth, verifyPassword } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { validateCsrfOrigin } from "@/lib/csrf";
import { MAX_FAILED_ATTEMPTS, MAX_LOCKOUT_CYCLES, getLockoutDuration, getClientIp, isRateLimited } from "@/lib/pin-utils";
import { logAuthEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    // CSRF origin validation
    const csrfError = validateCsrfOrigin(req);
    if (csrfError) return csrfError;

    // IP-based rate limiting — use platform-verified IP to prevent header spoofing
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return apiError("api.rateLimited", 429);
    }

    // Require an existing session
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      // The lock screen tells this 401 apart from a wrong PIN by the code —
      // the message is translated, so it can't be matched on.
      return apiError("api.sessionExpired", 401, undefined, { code: "SESSION_EXPIRED" });
    }

    const body = await req.json();
    const { pin } = body;

    if (!pin) {
      return apiError("api.pinRequired", 400);
    }

    const userId = session.user.id;

    // Atomically claim an attempt slot
    const now = Date.now();
    const claimed = await db
      .update(userPin)
      .set({
        failedAttempts: sql`CASE
          WHEN ${userPin.lockedUntil} IS NOT NULL AND ${userPin.lockedUntil} < ${now}
            THEN 1
          ELSE ${userPin.failedAttempts} + 1
        END`,
        lockedUntil: sql`CASE
          WHEN ${userPin.lockedUntil} IS NOT NULL AND ${userPin.lockedUntil} < ${now}
            THEN NULL
          ELSE ${userPin.lockedUntil}
        END`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        sql`${userPin.userId} = ${userId}
          AND (${userPin.lockedUntil} IS NULL OR ${userPin.lockedUntil} < ${now})
          AND (
            ${userPin.failedAttempts} < ${MAX_FAILED_ATTEMPTS}
            OR (${userPin.lockedUntil} IS NOT NULL AND ${userPin.lockedUntil} < ${now})
          )`
      )
      .returning({ failedAttempts: userPin.failedAttempts, pinHash: userPin.pinHash, lockoutCount: userPin.lockoutCount });

    if (!claimed.length) {
      const pinRecord = await db
        .select({ lockedUntil: userPin.lockedUntil, lockoutCount: userPin.lockoutCount })
        .from(userPin)
        .where(eq(userPin.userId, userId))
        .get();

      if (!pinRecord) {
        return apiError("api.invalidCredentials", 401);
      }

      if (pinRecord.lockoutCount >= MAX_LOCKOUT_CYCLES) {
        return apiError("api.tooManyAttemptsReauth", 403, undefined, { forceReauth: true });
      }

      if (pinRecord.lockedUntil && new Date(pinRecord.lockedUntil).getTime() > now) {
        const remainingMs = new Date(pinRecord.lockedUntil).getTime() - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        const { plural } = await requestI18n();
        return NextResponse.json(
          {
            error: plural(
              remainingMin,
              "api.tooManyAttemptsMinutes.one",
              "api.tooManyAttemptsMinutes.other",
            ),
          },
          { status: 429 },
        );
      }

      return apiError("api.tooManyAttempts", 429);
    }

    const { failedAttempts: newAttempts, pinHash, lockoutCount } = claimed[0];

    // Verify PIN
    const pinValid = await verifyPassword(pin, pinHash);

    if (!pinValid) {
      logAuthEvent({
        userId,
        action: "pin_unlock_failure",
        details: { attemptsUsed: newAttempts },
        ipAddress: ip,
        userAgent: req.headers.get("user-agent"),
      });

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const newLockoutCount = lockoutCount + 1;

        if (newLockoutCount >= MAX_LOCKOUT_CYCLES) {
          await db
            .update(userPin)
            .set({
              lockoutCount: newLockoutCount,
              lockedUntil: new Date(now + getLockoutDuration(newLockoutCount - 1)),
            })
            .where(eq(userPin.userId, userId));

          return apiError("api.tooManyAttemptsReauth", 403, undefined, { forceReauth: true });
        }

        await db
          .update(userPin)
          .set({
            lockoutCount: newLockoutCount,
            lockedUntil: new Date(now + getLockoutDuration(newLockoutCount - 1)),
          })
          .where(eq(userPin.userId, userId));
      }

      const attemptsLeft = MAX_FAILED_ATTEMPTS - newAttempts;
      if (attemptsLeft > 0 && attemptsLeft <= 2) {
        const { plural } = await requestI18n();
        return NextResponse.json(
          {
            error: plural(
              attemptsLeft,
              "api.invalidPinAttempts.one",
              "api.invalidPinAttempts.other",
            ),
          },
          { status: 401 },
        );
      }

      return apiError("api.invalidCredentials", 401);
    }

    // PIN is valid — reset failed attempts and lockout count
    await db
      .update(userPin)
      .set({ failedAttempts: 0, lockoutCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(userPin.userId, userId));

    logAuthEvent({
      userId,
      action: "pin_unlock_success",
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({ success: true });
  } catch {
    return apiError("api.serverError", 500);
  }
}
