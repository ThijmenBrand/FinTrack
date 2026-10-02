import { NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getJobForUser } from "@/lib/jobs/enqueue";

/**
 * GET /api/bank-sync/requests/:id
 * Poll a job this user queued: status, and its result once done. Another
 * user's job id answers 404 like a missing one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (userId) => {
    const { id } = await params;
    const job = await getJobForUser(userId, id);
    if (!job) return apiError("api.bankRequestNotFound", 404);
    return NextResponse.json({
      status: job.status,
      done: !["queued", "running"].includes(job.status),
      ok: job.status === "succeeded",
      result: job.status === "succeeded" ? job.result : null,
      errorCode: job.status === "succeeded" ? null : job.errorCode,
    });
  }, "Failed to read request");
}
