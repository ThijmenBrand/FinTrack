import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAccountLinks, bankConnections } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { createRateLimiter } from "@/lib/rate-limit";

const allow = createRateLimiter(5 * 60_000, 1);

/**
 * POST /api/bank-sync/links/:id/sync
 * "Sync now". The user is present, so the request carries their IP and user
 * agent to the bank (PSD2 PSU headers) and doesn't eat into the unattended
 * daily quota. Once per five minutes per account.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (userId) => {
    const { id } = await params;
    const [link] = await db
      .select({ id: bankAccountLinks.id, status: bankConnections.status })
      .from(bankAccountLinks)
      .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
      .where(and(eq(bankAccountLinks.id, id), eq(bankAccountLinks.userId, userId)))
      .limit(1);
    if (!link) return apiError("api.bankNotFound", 404);
    if (link.status !== "active") return apiError("api.bankAuthStateInvalid", 409);
    if (!allow(`${userId}:${link.id}`)) return apiError("api.bankRateLimited", 429);

    const meta = getRequestMeta(request.headers);
    const requestId = await enqueueJob(
      userId,
      "bank.sync_link",
      {
        linkId: link.id,
        ...(meta.ipAddress ? { psu: { ip: meta.ipAddress, userAgent: meta.userAgent ?? "" } } : {}),
      },
      { priority: JOB_PRIORITY.interactive, dedupeKey: `sync:${link.id}` },
    );
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to start sync");
}
