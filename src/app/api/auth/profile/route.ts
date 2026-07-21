import { NextRequest, NextResponse } from "next/server";
import { auth, withUser, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { logAuthEvent, logDataEvent, getRequestMeta } from "@/lib/audit";
import { validatePassword, validateName } from "@/lib/validation";

// In-memory rate limiter for password attempts per user
const PASSWORD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PASSWORD_MAX_ATTEMPTS = 5;
const passwordAttempts = new Map<string, { count: number; resetAt: number }>();

function checkPasswordRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = passwordAttempts.get(userId);

  if (!entry || now >= entry.resetAt) {
    passwordAttempts.set(userId, { count: 1, resetAt: now + PASSWORD_WINDOW_MS });
    return true;
  }

  if (entry.count >= PASSWORD_MAX_ATTEMPTS) {
    return false;
  }

  entry.count++;
  return true;
}

export async function GET() {
  return withUser(async (userId) => {
    const result = await db.run(
      sql`SELECT id, username, display_username, name, role, created_at FROM "user" WHERE id = ${userId}`
    );
    const user = result.rows[0] as Record<string, unknown> | undefined;

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      username: user.username,
      displayUsername: user.display_username || user.name,
      isAdmin: user.role === "admin",
      createdAt: user.created_at,
    });
  }, "Failed to fetch profile");
}

export async function PATCH(req: NextRequest) {
  return withUser(async (userId) => {
    const body = await req.json();
    const { displayUsername, username, currentPassword, newPassword } = body;

    const result = await db.run(
      sql`SELECT id, username FROM "user" WHERE id = ${userId}`
    );
    const user = result.rows[0] as Record<string, unknown> | undefined;

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Update display name and/or username
    if (displayUsername !== undefined) {
      const displayCheck = validateName(displayUsername);
      if (!displayCheck.ok) {
        return NextResponse.json({ error: `Invalid display name: ${displayCheck.error}` }, { status: 400 });
      }
      await db.run(
        sql`UPDATE "user" SET name = ${displayCheck.value}, display_username = ${displayCheck.value}, updated_at = ${new Date().toISOString()} WHERE id = ${userId}`
      );
    }

    if (username !== undefined) {
      const usernameCheck = validateName(username);
      if (!usernameCheck.ok) {
        return NextResponse.json({ error: `Invalid username: ${usernameCheck.error}` }, { status: 400 });
      }
      const clean = usernameCheck.value;
      // Uniqueness enforced inside the UPDATE so a concurrent claim of the
      // same username can't slip between a check and the write.
      const updated = await db.run(
        sql`UPDATE "user" SET username = ${clean}, email = ${clean + '@local'}, updated_at = ${new Date().toISOString()}
            WHERE id = ${userId}
            AND NOT EXISTS (SELECT 1 FROM "user" WHERE username = ${clean} AND id != ${userId})`
      );
      if (Number(updated.rowsAffected) === 0) {
        return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      }
    }

    // Password change
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "Current password is required to set a new password" },
          { status: 400 }
        );
      }

      if (!checkPasswordRateLimit(userId)) {
        return NextResponse.json(
          { error: "Too many password attempts. Please try again later." },
          { status: 429 }
        );
      }

      // Get password hash from auth account table
      const acctResult = await db.run(
        sql`SELECT password FROM account WHERE user_id = ${userId} AND provider_id = 'credential'`
      );
      const acct = acctResult.rows[0] as Record<string, unknown> | undefined;
      if (!acct?.password) {
        return NextResponse.json({ error: "No credential account found" }, { status: 400 });
      }

      const valid = await verifyPassword(currentPassword, acct.password as string);
      if (!valid) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
      }
      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      const hashed = await hashPassword(newPassword);
      await db.run(
        sql`UPDATE account SET password = ${hashed}, updated_at = ${new Date().toISOString()} WHERE user_id = ${userId} AND provider_id = 'credential'`
      );
    }

    if (!displayUsername && !username && !newPassword) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }

    // Audit logging
    const { ipAddress, userAgent } = getRequestMeta(req.headers);
    if (newPassword) {
      logAuthEvent({ userId, action: "password_change", ipAddress, userAgent });
    }
    if (displayUsername !== undefined || username !== undefined) {
      logDataEvent({
        userId,
        action: "profile_update",
        targetId: userId,
        targetType: "user",
        details: {
          ...(displayUsername !== undefined && { displayUsername }),
          ...(username !== undefined && { username }),
        },
        ipAddress,
        userAgent,
      });
    }

    return NextResponse.json({ success: true });
  }, "Failed to update profile");
}
