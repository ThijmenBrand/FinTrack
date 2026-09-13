import { db, adminDb } from "@/db/index";
import { auditLog } from "@/db/schema";
import { and, eq, gte, lt, lte, ne, type SQL } from "drizzle-orm";

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
 * Log an audit event. Fire-and-forget — never throws. Takes an array for bulk
 * mutations, so a 100-row delete writes one insert instead of 100.
 */
export async function logAudit(params: AuditParams | AuditParams[]): Promise<void> {
  const rows = (Array.isArray(params) ? params : [params]).map((p) => ({
    userId: p.userId,
    category: p.category,
    action: p.action,
    targetId: p.targetId ?? null,
    targetType: p.targetType ?? null,
    details: p.details ? JSON.stringify(p.details) : null,
    ipAddress: p.ipAddress ?? null,
    userAgent: p.userAgent ?? null,
  }));
  if (!rows.length) return;
  try {
    await db.insert(auditLog).values(rows);
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}

/**
 * Log an auth-related event (login, logout, etc.)
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

type DataEventParams = Omit<AuditParams, "category" | "userId"> & { userId: string };

/**
 * Log a data mutation event (transaction, account, budget, category CRUD).
 * Accepts an array to log a bulk mutation in one insert.
 */
export async function logDataEvent(
  params: DataEventParams | DataEventParams[],
): Promise<void> {
  const list = Array.isArray(params) ? params : [params];
  return logAudit(list.map((p) => ({ ...p, category: "data" as const })));
}

/**
 * Extract IP address and User-Agent from request headers. Uses the LAST
 * X-Forwarded-For entry — appended by the trusted edge proxy — so audit logs
 * can't be spoofed by a client-supplied XFF prefix.
 */
export function getRequestMeta(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const xff = headers.get("x-forwarded-for");
  const parts = xff ? xff.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const ipAddress =
    parts.length > 0 ? parts[parts.length - 1] : headers.get("x-real-ip") || null;
  const userAgent = headers.get("user-agent") || null;
  return { ipAddress, userAgent };
}

/**
 * Build the WHERE clause for audit-log list/export from query params.
 * Shared by the list route and the CSV export so filters can't drift apart.
 */
export function buildAuditLogFilter(searchParams: URLSearchParams): SQL | undefined {
  const userId = searchParams.get("userId");
  const category = searchParams.get("category");
  const action = searchParams.get("action");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const conditions: SQL[] = [];
  if (userId) conditions.push(eq(auditLog.userId, userId));
  if (category) conditions.push(eq(auditLog.category, category));
  if (action) conditions.push(eq(auditLog.action, action));
  if (dateFrom) conditions.push(gte(auditLog.createdAt, dateFrom));
  if (dateTo) conditions.push(lte(auditLog.createdAt, dateTo + "T23:59:59.999Z"));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Escape a value for one CSV cell (RFC 4180 quote-doubling). Cells starting
 * with a formula trigger get a leading apostrophe — display names and
 * user agents are attacker-controlled, and Excel executes `=`/`@` cells.
 */
export function toCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Delete audit log entries older than the specified number of days.
 * `pot.allocate` rows are exempt: they double as the pots feature's allocation
 * history (read by /api/pots/[id]/details). Move them to their own table if
 * more actions become product data.
 */
export async function cleanupOldAuditLogs(retentionDays: number = 90): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    // Retention sweep is deliberately cross-user, so it takes the unguarded
    // handle.
    const result = await adminDb
      .delete(auditLog)
      .where(and(lt(auditLog.createdAt, cutoff), ne(auditLog.action, "pot.allocate")));
    return (result as unknown as { rowsAffected?: number }).rowsAffected || 0;
  } catch (err) {
    console.error("Audit log cleanup failed:", err);
    return 0;
  }
}
