import { NextRequest, NextResponse } from "next/server";
import { adminDb as db } from "@/db";
import { auditLog } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { eq, desc, sql } from "drizzle-orm";
import { withAdmin } from "@/lib/auth";
import { buildAuditLogFilter, cleanupOldAuditLogs } from "@/lib/audit";

// GET /api/admin/audit-logs — list audit logs with filtering and pagination
export async function GET(request: NextRequest) {
  return withAdmin(async () => {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 50));
    const whereClause = buildAuditLogFilter(searchParams);
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(whereClause);
    const total = countResult[0]?.count || 0;

    const rows = await db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        category: auditLog.category,
        action: auditLog.action,
        targetId: auditLog.targetId,
        targetType: auditLog.targetType,
        details: auditLog.details,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
        createdAt: auditLog.createdAt,
        displayName: user.name,
      })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.userId, user.id))
      .where(whereClause)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const data = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.displayName || null,
      category: row.category,
      action: row.action,
      targetId: row.targetId || null,
      targetType: row.targetType || null,
      details: row.details ? (() => { try { return JSON.parse(row.details); } catch { return null; } })() : null,
      ipAddress: row.ipAddress || null,
      userAgent: row.userAgent || null,
      createdAt: row.createdAt,
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
  }, "Failed to fetch audit logs");
}

// POST /api/admin/audit-logs — cleanup old audit logs
export async function POST() {
  return withAdmin(async () => {
    const deleted = await cleanupOldAuditLogs(90);

    return NextResponse.json({ success: true, deleted });
  }, "Failed to cleanup audit logs");
}
