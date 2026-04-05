import { NextRequest, NextResponse } from "next/server";
import { auth, verifyPassword } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { validateCsrfOrigin } from "@/lib/csrf";
import { MAX_FAILED_ATTEMPTS, MAX_LOCKOUT_CYCLES, getLockoutDuration, getClientIp, isRateLimited } from "@/lib/pin-utils";

export async function POST(req: NextRequest) {
  try {
    // CSRF origin validation
    const csrfError = validateCsrfOrigin(req);
    if (csrfError) return csrfError;

    // IP-based rate limiting — use platform-verified IP to prevent header spoofing
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // Require an existing session
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Session expired. Please sign in again." },
        { status: 401 },
      );
    }

    const body = await req.json();
    const { pin } = body;

    if (!pin) {
      return NextResponse.json(
        { error: "PIN is required" },
        { status: 400 },
      );
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
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }

      if (pinRecord.lockoutCount >= MAX_LOCKOUT_CYCLES) {
        return NextResponse.json(
          { error: "Too many failed attempts. Please sign in with your password.", forceReauth: true },
          { status: 403 },
        );
      }

      if (pinRecord.lockedUntil && new Date(pinRecord.lockedUntil).getTime() > now) {
        const remainingMs = new Date(pinRecord.lockedUntil).getTime() - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.` },
          { status: 429 },
        );
      }

      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        { status: 429 },
      );
    }

    const { failedAttempts: newAttempts, pinHash, lockoutCount } = claimed[0];

    // Verify PIN
    const pinValid = await verifyPassword(pin, pinHash);

    if (!pinValid) {
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

          return NextResponse.json(
            { error: "Too many failed attempts. Please sign in with your password.", forceReauth: true },
            { status: 403 },
          );
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
        return NextResponse.json(
          { error: `Invalid PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining.` },
          { status: 401 },
        );
      }

      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // PIN is valid — reset failed attempts and lockout count
    await db
      .update(userPin)
      .set({ failedAttempts: 0, lockoutCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(userPin.userId, userId));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
