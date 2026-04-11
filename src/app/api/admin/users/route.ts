import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { seedCategoriesForUser } from "@/db/migrate";
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
  try {
    await requireAdmin();

    const result = await db.run(sql`
      SELECT
        u.id, u.username, u.name, u.display_username, u.role, u.created_at,
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
        isAdmin: row.role === "admin",
        createdAt: row.created_at,
        lastActive: row.last_active ?? null,
        accountCount: Number(row.account_count) || 0,
        transactionCount: Number(row.transaction_count) || 0,
        hasPin: Number(row.has_pin) > 0,
        passkeyCount: Number(row.passkey_count) || 0,
      }))
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to fetch users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}

// POST /api/admin/users — create a new user
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    const { username, password, displayUsername, isAdmin } = await request.json();

    if (!username || !password || !displayUsername) {
      return NextResponse.json(
        { error: "username, password, and displayUsername are required" },
        { status: 400 }
      );
    }

    // Check for duplicate username
    const existing = await db.run(
      sql`SELECT id FROM "user" WHERE username = ${username}`
    );
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);
    const now = Date.now();

    await db.run(sql`
      INSERT INTO "user" (id, name, email, email_verified, username, display_username, role, created_at, updated_at)
      VALUES (${id}, ${displayUsername}, ${username + '@local'}, 0, ${username}, ${displayUsername}, ${isAdmin ? 'admin' : 'user'}, ${now}, ${now})
    `);

    // Create credential account
    await db.run(sql`
      INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${hashedPassword}, ${now}, ${now})
    `);

    // Seed default categories for the new user
    await seedCategoriesForUser(id);

    await logAdminAction(session.userId, "user_create", id, {
      username,
      displayUsername,
      isAdmin: !!isAdmin,
    });

    return NextResponse.json(
      {
        id,
        username,
        displayUsername,
        isAdmin: !!isAdmin,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to create user:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}

// PUT /api/admin/users — update user (reset password, change display name, toggle admin)
export async function PUT(request: NextRequest) {
  try {
    const session = await requireAdmin();

    const { id, password, displayUsername, isAdmin } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const now = Date.now();

    if (password) {
      const hashedPassword = await hashPassword(password);
      await db.run(
        sql`UPDATE account SET password = ${hashedPassword}, updated_at = ${now} WHERE user_id = ${id} AND provider_id = 'credential'`
      );
      await logAdminAction(session.userId, "password_reset", id);
    }

    if (displayUsername !== undefined) {
      await db.run(
        sql`UPDATE "user" SET name = ${displayUsername}, display_username = ${displayUsername}, updated_at = ${now} WHERE id = ${id}`
      );
      await logAdminAction(session.userId, "display_name_change", id, { displayUsername });
    }

    if (isAdmin !== undefined) {
      await db.run(
        sql`UPDATE "user" SET role = ${isAdmin ? 'admin' : 'user'}, updated_at = ${now} WHERE id = ${id}`
      );
      await logAdminAction(session.userId, "role_change", id, { newRole: isAdmin ? "admin" : "user" });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to update user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users?id=X — delete a user and all their data
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAdmin();

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
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to delete user:", error);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
