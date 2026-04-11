import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { eq, and, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { cleanupOldAuditLogs } from "@/lib/audit";

// GET /api/admin/audit-logs — list audit logs with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 50));
    const userId = searchParams.get("userId");
    const category = searchParams.get("category");
    const action = searchParams.get("action");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Build WHERE conditions
    const conditions: SQL[] = [];
    if (userId) conditions.push(eq(auditLog.userId, userId));
    if (category) conditions.push(eq(auditLog.category, category));
    if (action) conditions.push(eq(auditLog.action, action));
    if (dateFrom) conditions.push(gte(auditLog.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(auditLog.createdAt, dateTo + "T23:59:59.999Z"));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(whereClause);
    const total = countResult[0]?.count || 0;

    // Get paginated results with user info via raw join
    const result = await db.run(sql`
      SELECT a.*, u.username, u.display_username, u.name as user_display_name
      FROM audit_log a
      LEFT JOIN "user" u ON a.user_id = u.id
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const data = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username || null,
      displayUsername: row.display_username || row.user_display_name || null,
      category: row.category,
      action: row.action,
      targetId: row.target_id || null,
      targetType: row.target_type || null,
      details: row.details ? (() => { try { return JSON.parse(row.details as string); } catch { return null; } })() : null,
      ipAddress: row.ip_address || null,
      userAgent: row.user_agent || null,
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to fetch audit logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit logs" },
      { status: 500 }
    );
  }
}

// POST /api/admin/audit-logs — cleanup old audit logs
export async function POST() {
  try {
    await requireAdmin();

    const deleted = await cleanupOldAuditLogs(90);

    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to cleanup audit logs:", error);
    return NextResponse.json(
      { error: "Failed to cleanup audit logs" },
      { status: 500 }
    );
  }
}
