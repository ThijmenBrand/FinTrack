import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { withUser, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { logAuthEvent, logDataEvent, getRequestMeta } from "@/lib/audit";
import { validatePassword, validateName } from "@/lib/validation";
import { createRateLimiter } from "@/lib/rate-limit";

// Password attempts per user: 5 per 15 minutes.
const checkPasswordRateLimit = createRateLimiter(15 * 60 * 1000, 5);

export async function GET() {
  return withUser(async (userId) => {
    const result = await db.run(
      sql`SELECT id, name, email, image, role, two_factor_enabled, created_at FROM "user" WHERE id = ${userId}`
    );
    const user = result.rows[0] as Record<string, unknown> | undefined;

    if (!user) {
      return apiError("api.userNotFound", 404);
    }

    return NextResponse.json({
      id: user.id,
      displayName: user.name,
      email: user.email,
      imageUrl: user.image ?? null,
      isAdmin: user.role === "admin",
      twoFactorEnabled: user.two_factor_enabled === 1 || user.two_factor_enabled === true,
      createdAt: user.created_at,
    });
  }, "Failed to fetch profile");
}

export async function PATCH(req: NextRequest) {
  return withUser(async (userId) => {
    const body = await req.json();
    const { displayName, currentPassword, newPassword } = body;

    const result = await db.run(
      sql`SELECT id FROM "user" WHERE id = ${userId}`
    );
    const user = result.rows[0] as Record<string, unknown> | undefined;

    if (!user) {
      return apiError("api.userNotFound", 404);
    }

    if (displayName !== undefined) {
      const displayCheck = validateName(displayName);
      if (!displayCheck.ok) {
        return apiError(displayCheck.error, 400, displayCheck.vars);
      }
      await db.run(
        sql`UPDATE "user" SET name = ${displayCheck.value}, updated_at = ${new Date().toISOString()} WHERE id = ${userId}`
      );
    }

    // Password change
    if (newPassword) {
      if (!currentPassword) {
        return apiError("api.currentPasswordForNewPassword", 400);
      }

      if (!checkPasswordRateLimit(userId)) {
        return apiError("api.rateLimitedPassword", 429);
      }

      // Get password hash from auth account table
      const acctResult = await db.run(
        sql`SELECT password FROM account WHERE user_id = ${userId} AND provider_id = 'credential'`
      );
      const acct = acctResult.rows[0] as Record<string, unknown> | undefined;
      if (!acct?.password) {
        return apiError("api.noCredentialAccount", 400);
      }

      const valid = await verifyPassword(currentPassword, acct.password as string);
      if (!valid) {
        return apiError("api.currentPasswordIncorrect", 403);
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

    if (!displayName && !newPassword) {
      return apiError("api.noChanges", 400);
    }

    // Audit logging
    const { ipAddress, userAgent } = getRequestMeta(req.headers);
    if (newPassword) {
      logAuthEvent({ userId, action: "password_change", ipAddress, userAgent });
    }
    if (displayName !== undefined) {
      logDataEvent({
        userId,
        action: "profile_update",
        targetId: userId,
        targetType: "user",
        details: { displayName },
        ipAddress,
        userAgent,
      });
    }

    return NextResponse.json({ success: true });
  }, "Failed to update profile");
}
