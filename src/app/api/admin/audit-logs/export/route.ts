import { NextRequest } from "next/server";
import { adminDb as db } from "@/db";
import { auditLog } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { eq, desc } from "drizzle-orm";
import { withAdmin } from "@/lib/auth";
import { buildAuditLogFilter, toCsvCell } from "@/lib/audit";

// ponytail: in-memory CSV capped at 10k rows — fine at 90-day retention
// volumes; stream if exports ever get truncated.
const MAX_ROWS = 10_000;

// GET /api/admin/audit-logs/export — CSV of the filtered audit log
export async function GET(request: NextRequest) {
  return withAdmin(async () => {
    const { searchParams } = new URL(request.url);

    const rows = await db
      .select({
        createdAt: auditLog.createdAt,
        displayName: user.name,
        category: auditLog.category,
        action: auditLog.action,
        targetId: auditLog.targetId,
        targetType: auditLog.targetType,
        details: auditLog.details,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
      })
      .from(auditLog)
      .leftJoin(user, eq(auditLog.userId, user.id))
      .where(buildAuditLogFilter(searchParams))
      .orderBy(desc(auditLog.createdAt))
      .limit(MAX_ROWS);

    const header = "created_at,display_name,category,action,target_id,target_type,details,ip_address,user_agent";
    const csv = [
      header,
      ...rows.map((r) =>
        [
          r.createdAt,
          r.displayName,
          r.category,
          r.action,
          r.targetId,
          r.targetType,
          r.details,
          r.ipAddress,
          r.userAgent,
        ]
          .map(toCsvCell)
          .join(","),
      ),
    ].join("\r\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="audit-logs.csv"',
      },
    });
  }, "Failed to export audit logs");
}
