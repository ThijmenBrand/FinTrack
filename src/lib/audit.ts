import { db } from "@/db/index";
import { auditLog } from "@/db/schema";
import { lt } from "drizzle-orm";

export type AuditCategory = "auth" | "data" | "admin";

interface AuditParams {
  userId: string | null;
  category: AuditCategory;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Log an audit event. Fire-and-forget — never throws.
 */
export async function logAudit(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: params.userId,
      category: params.category,
      action: params.action,
      targetId: params.targetId ?? null,
      targetType: params.targetType ?? null,
      details: params.details ? JSON.stringify(params.details) : null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}

/**
 * Log an auth-related event (login, logout, PIN unlock, etc.)
 */
export async function logAuthEvent(params: {
  userId: string | null;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  return logAudit({ ...params, category: "auth" });
}

/**
 * Log a data mutation event (transaction, account, budget, category CRUD)
 */
export async function logDataEvent(params: {
  userId: string;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  return logAudit({ ...params, category: "data" });
}

/**
 * Extract IP address and User-Agent from request headers.
 */
export function getRequestMeta(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const xff = headers.get("x-forwarded-for");
  const ipAddress = xff
    ? xff.split(",")[0]?.trim() || null
    : headers.get("x-real-ip") || null;
  const userAgent = headers.get("user-agent") || null;
  return { ipAddress, userAgent };
}

/**
 * Delete audit log entries older than the specified number of days.
 */
export async function cleanupOldAuditLogs(retentionDays: number = 90): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoff));
    return (result as unknown as { rowsAffected?: number }).rowsAffected || 0;
  } catch (err) {
    console.error("Audit log cleanup failed:", err);
    return 0;
  }
}
