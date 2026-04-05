import { NextRequest, NextResponse } from "next/server";
import { auth, verifyPassword } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin, user } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { validateCsrfOrigin } from "@/lib/csrf";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ─── IP-based rate limiter ──────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // max 5 requests per IP per minute

const ipRequestMap = new Map<string, number[]>();

// Periodically clean up stale entries to prevent memory leaks
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of ipRequestMap) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      ipRequestMap.delete(ip);
    } else {
      ipRequestMap.set(ip, filtered);
    }
  }
}, 5 * 60 * 1000); // clean every 5 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (ipRequestMap.get(ip) || []).filter((t) => t > cutoff);
  timestamps.push(now);
  ipRequestMap.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

export async function POST(req: NextRequest) {
  try {
    // CSRF origin validation
    const csrfError = validateCsrfOrigin(req);
    if (csrfError) return csrfError;

    // IP-based rate limiting
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { username: inputUsername, pin } = body;

    if (!inputUsername || !pin) {
      return NextResponse.json(
        { error: "Username and PIN are required" },
        { status: 400 },
      );
    }

    // Look up user by username
    const foundUser = await db
      .select()
      .from(user)
      .where(eq(user.username, inputUsername))
      .get();

    if (!foundUser) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Check if user is banned
    if (foundUser.banned) {
      return NextResponse.json({ error: "Account is suspended" }, { status: 403 });
    }

    // Atomically claim an attempt slot. If a previous lockout has expired,
    // reset the counter to 1 (this attempt); otherwise increment.
    // The WHERE guard rejects users who are still locked out.
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
        sql`${userPin.userId} = ${foundUser.id}
          AND (${userPin.lockedUntil} IS NULL OR ${userPin.lockedUntil} < ${now})
          AND (
            ${userPin.failedAttempts} < ${MAX_FAILED_ATTEMPTS}
            OR (${userPin.lockedUntil} IS NOT NULL AND ${userPin.lockedUntil} < ${now})
          )`
      )
      .returning({ failedAttempts: userPin.failedAttempts, pinHash: userPin.pinHash });

    // If no rows updated: either no PIN record, or user is locked out / at limit
    if (!claimed.length) {
      const pinRecord = await db
        .select({ lockedUntil: userPin.lockedUntil })
        .from(userPin)
        .where(eq(userPin.userId, foundUser.id))
        .get();

      if (!pinRecord) {
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }

      if (pinRecord.lockedUntil && new Date(pinRecord.lockedUntil).getTime() > now) {
        const remainingMs = new Date(pinRecord.lockedUntil).getTime() - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.` },
          { status: 429 },
        );
      }

      // failedAttempts already at limit but lockout not yet written — treat as locked
      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        { status: 429 },
      );
    }

    const { failedAttempts: newAttempts, pinHash } = claimed[0];

    // Verify PIN
    const pinValid = await verifyPassword(pin, pinHash);

    if (!pinValid) {
      // If this attempt hit the limit, set lockout (keep failedAttempts at max
      // so the counter isn't available for fresh brute-force attempts)
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        await db
          .update(userPin)
          .set({
            lockedUntil: new Date(now + LOCKOUT_DURATION_MS),
          })
          .where(eq(userPin.userId, foundUser.id));
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

    // PIN is valid — reset failed attempts
    await db
      .update(userPin)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(userPin.userId, foundUser.id));

    // Create session via better-auth's internal adapter (fires hooks, proper token generation, etc.)
    const ctx = await auth.$context;
    const newSession = await ctx.internalAdapter.createSession(
      foundUser.id,
      false, // rememberMe
      {
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") || "",
        userAgent: req.headers.get("user-agent") || "",
      },
    );
    if (!newSession) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    // Sign the session token and set cookie using better-auth's cookie config
    const { makeSignature } = await import("better-auth/crypto");
    const cookieConfig = ctx.authCookies.sessionToken;
    const signedToken = `${newSession.token}.${await makeSignature(newSession.token, ctx.secret)}`;
    const maxAge = ctx.sessionConfig.expiresIn;

    const response = NextResponse.json({ success: true });
    const { sameSite, ...restAttrs } = cookieConfig.attributes;
    response.cookies.set(cookieConfig.name, signedToken, {
      ...restAttrs,
      sameSite: (sameSite?.toLowerCase() as "lax" | "strict" | "none") || "lax",
      maxAge,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
