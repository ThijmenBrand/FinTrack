import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { adminDb as db } from "@/db";
import { user } from "@/db/auth-schema";
import { discardDeadJob, lastHeartbeat, listDeadJobs, replayDeadJob } from "@/db/jobs";
import { withAdmin } from "@/lib/auth";
import { withAdminStepUp } from "@/lib/step-up";
import { apiError } from "@/lib/api-errors";
import { logAudit, getRequestMeta } from "@/lib/audit";

/**
 * GET /api/admin/jobs — the dead-letter queue: what failed, for whom, why.
 * Metadata only — an admin never sees a job's payload or a user's bank data.
 */
export async function GET() {
  return withAdmin(async () => {
    const jobs = await listDeadJobs();
    const userIds = [...new Set(jobs.map((j) => j.userId))];
    const names = userIds.length
      ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
      : [];
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    return NextResponse.json({
      workerSeenAt: await lastHeartbeat(),
      jobs: jobs.map((j) => ({ ...j, displayName: nameById.get(j.userId) ?? null })),
    });
  }, "Failed to list dead jobs");
}

/**
 * POST /api/admin/jobs  { id, action: "replay" | "discard" }  (step-up)
 * Give a dead job a fresh set of attempts, or drop it.
 */
export async function POST(request: NextRequest) {
  return withAdminStepUp(async ({ userId }) => {
    const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const action = body?.action;
    if (!id || (action !== "replay" && action !== "discard")) return apiError("api.jobActionInvalid", 400);
    const job = action === "replay" ? await replayDeadJob(id) : await discardDeadJob(id);
    if (!job) return apiError("api.bankRequestNotFound", 404);
    await logAudit({
      userId,
      category: "admin",
      action: action === "replay" ? "job_replayed" : "job_discarded",
      targetId: job.id,
      targetType: "job",
      details: { type: job.type, jobUserId: job.userId },
      ...getRequestMeta(request.headers),
    });
    return NextResponse.json({ ok: true });
  }, "Failed to update dead job");
}
