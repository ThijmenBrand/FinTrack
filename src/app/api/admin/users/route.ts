import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { withAdmin, hashPassword } from "@/lib/auth";
import { validatePassword, validateName, validateEmail } from "@/lib/validation";
import { logAudit, getRequestMeta } from "@/lib/audit";
import { headers } from "next/headers";

async function logAdminAction(
  adminId: string,
  action: string,
  targetUserId: string,
  details?: Record<string, unknown>,
) {
  const hdrs = await headers();
  const { ipAddress, userAgent } = getRequestMeta(hdrs);
  await logAudit({
    userId: adminId,
    category: "admin",
    action,
    targetId: targetUserId,
    targetType: "user",
    details,
    ipAddress,
    userAgent,
  });
}

// GET /api/admin/users — list all users
export async function GET() {
  return withAdmin(async (session) => {
    const result = await db.run(sql`
      SELECT
        u.id, u.username, u.name, u.display_username, u.role, u.created_at,
        u.banned, u.ban_reason, u.email, u.email_verified,
        (SELECT MAX(s.updated_at) FROM session s WHERE s.user_id = u.id) AS last_active,
        (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS account_count,
        (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS transaction_count,
        (SELECT COUNT(*) FROM user_pin p WHERE p.user_id = u.id) AS has_pin,
        (SELECT COUNT(*) FROM passkey pk WHERE pk.user_id = u.id) AS passkey_count
      FROM "user" u
      ORDER BY u.created_at ASC
    `);

    return NextResponse.json(
      result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        username: row.username,
        displayUsername: row.display_username || row.name,
        email: row.email,
        emailVerified: Number(row.email_verified) === 1,
        role: row.role === "admin" ? "admin" : "user",
        isAdmin: row.role === "admin",
        isCurrentUser: row.id === session.userId,
        createdAt: row.created_at,
        lastActive: row.last_active ?? null,
        accountCount: Number(row.account_count) || 0,
        transactionCount: Number(row.transaction_count) || 0,
        hasPin: Number(row.has_pin) > 0,
        passkeyCount: Number(row.passkey_count) || 0,
        banned: Number(row.banned) === 1,
        banReason: (row.ban_reason as string) ?? null,
      }))
    );
  }, "Failed to fetch users");
}

// Accounts are created by invite only — see /api/admin/invites.

// PUT /api/admin/users — update user (reset password, change display name or
// email, toggle verified/admin, ban)
export async function PUT(request: NextRequest) {
  return withAdmin(async (session) => {
    const { id, password, displayUsername, username, email, emailVerified, isAdmin, banned, banReason } =
      await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const now = Date.now();

    if (password) {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      const hashedPassword = await hashPassword(password);
      await db.run(
        sql`UPDATE account SET password = ${hashedPassword}, updated_at = ${now} WHERE user_id = ${id} AND provider_id = 'credential'`
      );
      await logAdminAction(session.userId, "password_reset", id);
    }

    if (displayUsername !== undefined) {
      const displayCheck = validateName(displayUsername);
      if (!displayCheck.ok) {
        return NextResponse.json({ error: `Invalid display name: ${displayCheck.error}` }, { status: 400 });
      }
      await db.run(
        sql`UPDATE "user" SET name = ${displayCheck.value}, display_username = ${displayCheck.value}, updated_at = ${now} WHERE id = ${id}`
      );
      await logAdminAction(session.userId, "display_name_change", id, { displayUsername: displayCheck.value });
    }

    if (username !== undefined) {
      const usernameCheck = validateName(username);
      if (!usernameCheck.ok) {
        return NextResponse.json({ error: `Invalid username: ${usernameCheck.error}` }, { status: 400 });
      }
      const updated = await db.run(sql`
        UPDATE "user" SET username = ${usernameCheck.value}, updated_at = ${now}
        WHERE id = ${id}
          AND NOT EXISTS (SELECT 1 FROM "user" WHERE username = ${usernameCheck.value} AND id <> ${id})
      `);
      if (Number(updated.rowsAffected) === 0) {
        return NextResponse.json({ error: "That username is already in use" }, { status: 409 });
      }
      await logAdminAction(session.userId, "username_change", id, { username: usernameCheck.value });
    }

    if (email !== undefined) {
      const emailError = validateEmail(email);
      if (emailError) {
        return NextResponse.json({ error: emailError }, { status: 400 });
      }
      const cleanEmail = (email as string).trim().toLowerCase();
      // A new address is unproven, so verification drops until an admin (or a
      // verification link) says otherwise. NOT EXISTS keeps the unique check atomic.
      const updated = await db.run(sql`
        UPDATE "user" SET email = ${cleanEmail}, email_verified = 0, updated_at = ${now}
        WHERE id = ${id}
          AND NOT EXISTS (SELECT 1 FROM "user" WHERE email = ${cleanEmail} AND id <> ${id})
      `);
      if (Number(updated.rowsAffected) === 0) {
        return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
      }
      await logAdminAction(session.userId, "email_change", id, { email: cleanEmail });
    }

    if (emailVerified !== undefined) {
      if (typeof emailVerified !== "boolean") {
        return NextResponse.json({ error: "emailVerified must be a boolean" }, { status: 400 });
      }
      await db.run(
        sql`UPDATE "user" SET email_verified = ${emailVerified ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`
      );
      await logAdminAction(session.userId, "email_verified_change", id, { emailVerified });
    }

    if (isAdmin !== undefined) {
      if (typeof isAdmin !== "boolean") {
        return NextResponse.json({ error: "isAdmin must be a boolean" }, { status: 400 });
      }
      // Prevent demoting yourself — guarantees at least one admin remains
      if (id === session.userId) {
        return NextResponse.json(
          { error: "Cannot change your own role" },
          { status: 400 }
        );
      }
      await db.run(
        sql`UPDATE "user" SET role = ${isAdmin ? 'admin' : 'user'}, updated_at = ${now} WHERE id = ${id}`
      );
      await logAdminAction(session.userId, "role_change", id, { newRole: isAdmin ? "admin" : "user" });
    }

    if (banned !== undefined) {
      if (typeof banned !== "boolean") {
        return NextResponse.json({ error: "banned must be a boolean" }, { status: 400 });
      }
      // Prevent banning yourself — combined with the self-delete and self-role
      // guards, at least one working admin always remains.
      if (id === session.userId) {
        return NextResponse.json(
          { error: "Cannot ban your own account" },
          { status: 400 }
        );
      }
      const reason = banned && typeof banReason === "string" && banReason.trim()
        ? banReason.trim().slice(0, 500)
        : null;
      await db.run(
        sql`UPDATE "user" SET banned = ${banned ? 1 : 0}, ban_reason = ${reason}, ban_expires = NULL, updated_at = ${now} WHERE id = ${id}`
      );
      if (banned) {
        // Revoke open sessions immediately — the sign-in block alone would let
        // an existing session live until it expires.
        await db.run(sql`DELETE FROM session WHERE user_id = ${id}`);
      }
      await logAdminAction(session.userId, banned ? "user_ban" : "user_unban", id, reason ? { reason } : undefined);
    }

    return NextResponse.json({ success: true });
  }, "Failed to update user");
}

// DELETE /api/admin/users?id=X — delete a user and all their data
export async function DELETE(request: NextRequest) {
  return withAdmin(async (session) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    // Prevent deleting yourself
    if (id === session.userId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    // Look up the target user's username before deletion for the audit log
    const targetUser = await db.run(sql`SELECT username FROM "user" WHERE id = ${id}`);
    const targetUsername = (targetUser.rows[0] as Record<string, unknown>)?.username as string | undefined;

    // Log before delete since the target user row will be cascade-deleted
    await logAdminAction(session.userId, "user_delete", id, { username: targetUsername });

    // Delete user (cascade will handle related data)
    await db.run(sql`DELETE FROM "user" WHERE id = ${id}`);

    return NextResponse.json({ success: true });
  }, "Failed to delete user");
}
