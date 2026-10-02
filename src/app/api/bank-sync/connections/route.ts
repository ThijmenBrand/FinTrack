import { NextRequest, NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections, bankCredentials } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { MAX_CONNECTIONS_PER_USER, isBankSyncCountry } from "@/lib/bank-sync/config";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { withStepUp } from "@/lib/step-up";

const allow = createRateLimiter(5 * 60_000, 5);

/**
 * POST /api/bank-sync/connections  { aspspName, aspspCountry, connectionId? }  (step-up)
 * Start a trip to the bank — a new connection, or (with `connectionId`) the
 * renewal of an existing one. The worker mints the OAuth state, bound to THIS
 * session; the client polls `requestId` for the bank's URL.
 */
export async function POST(request: NextRequest) {
  return withStepUp(async (ids) => {
    const { userId } = ids;
    if (!allow(userId)) return apiError("api.bankRateLimited", 429);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const aspspName = typeof body?.aspspName === "string" ? body.aspspName.trim() : "";
    const aspspCountry = body?.aspspCountry;
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId : undefined;
    if (!aspspName || aspspName.length > 200) return apiError("api.bankInvalidBank", 400);
    if (!isBankSyncCountry(aspspCountry)) return apiError("api.bankInvalidCountry", 400);

    const [credential] = await db
      .select({ status: bankCredentials.status })
      .from(bankCredentials)
      .where(eq(bankCredentials.userId, userId))
      .limit(1);
    if (credential?.status !== "verified") return apiError("api.bankCredentialNotVerified", 409);

    if (connectionId) {
      const [connection] = await db
        .select()
        .from(bankConnections)
        .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)))
        .limit(1);
      if (!connection) return apiError("api.bankNotFound", 404);
      if (connection.aspspName !== aspspName || connection.aspspCountry !== aspspCountry) {
        return apiError("api.bankInvalidBank", 400);
      }
    } else {
      const [{ n }] = await db
        .select({ n: count() })
        .from(bankConnections)
        .where(eq(bankConnections.userId, userId));
      if (n >= MAX_CONNECTIONS_PER_USER) {
        return apiError("api.bankTooManyConnections", 409, { max: MAX_CONNECTIONS_PER_USER });
      }
    }

    const requestId = await enqueueJob(
      userId,
      "bank.start_auth",
      {
        sessionId: ids.sessionId,
        purpose: connectionId ? "reconnect" : "connect",
        aspspName,
        aspspCountry,
        ...(connectionId ? { connectionId } : {}),
      },
      { priority: JOB_PRIORITY.interactive, maxAttempts: 2 },
    );
    logDataEvent({
      userId,
      action: connectionId ? "bank_reconnect_started" : "bank_connect_started",
      targetId: connectionId ?? null,
      targetType: "bank_connection",
      details: { aspsp: aspspName, country: aspspCountry },
      ...getRequestMeta(request.headers),
    });
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to start bank connection");
}
