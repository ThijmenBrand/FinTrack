import { NextRequest, NextResponse } from "next/server";
import { auth, getUserId, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { logAuthEvent, logDataEvent, getRequestMeta } from "@/lib/audit";

// Common passwords list (top entries from breached password databases)
const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "1234567890", "qwerty",
  "abc123", "monkey", "1234567", "letmein", "trustno1",
  "dragon", "baseball", "iloveyou", "master", "sunshine",
  "ashley", "michael", "shadow", "123123", "654321",
  "superman", "qazwsx", "football", "password1", "password123",
  "welcome", "welcome1", "p@ssw0rd", "passw0rd", "admin",
  "administrator", "login", "hello", "charlie", "donald",
  "starwars", "access", "master1", "qwerty123", "mustang",
  "121212", "bailey", "freedom", "shadow1", "passpass",
  "whatever", "qwer1234", "zaq1zaq1", "000000", "111111",
  "1q2w3e4r", "zaq12wsx", "1qaz2wsx", "abcdefgh", "changeme",
]);

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
  const userId = await getUserId();

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
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId();
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
    if (!displayUsername.trim()) {
      return NextResponse.json({ error: "Display name cannot be empty" }, { status: 400 });
    }
    await db.run(
      sql`UPDATE "user" SET name = ${displayUsername.trim()}, display_username = ${displayUsername.trim()}, updated_at = ${Date.now()} WHERE id = ${userId}`
    );
  }

  if (username !== undefined) {
    if (!username.trim()) {
      return NextResponse.json({ error: "Username cannot be empty" }, { status: 400 });
    }
    const existing = await db.run(
      sql`SELECT id FROM "user" WHERE username = ${username.trim()}`
    );
    if (existing.rows.length > 0 && (existing.rows[0] as Record<string, unknown>).id !== userId) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    await db.run(
      sql`UPDATE "user" SET username = ${username.trim()}, email = ${username.trim() + '@local'}, updated_at = ${Date.now()} WHERE id = ${userId}`
    );
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
    if (newPassword.length < 10) {
      return NextResponse.json(
        { error: "New password must be at least 10 characters" },
        { status: 400 }
      );
    }
    if (COMMON_PASSWORDS.has(newPassword.toLowerCase())) {
      return NextResponse.json(
        { error: "This password is too common. Please choose a more unique password." },
        { status: 400 }
      );
    }
    const hashed = await hashPassword(newPassword);
    await db.run(
      sql`UPDATE account SET password = ${hashed}, updated_at = ${Date.now()} WHERE user_id = ${userId} AND provider_id = 'credential'`
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
}
