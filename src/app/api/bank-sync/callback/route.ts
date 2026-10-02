import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bankAuthStates } from "@/db/schema";
import { withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { createRateLimiter } from "@/lib/rate-limit";

const allow = createRateLimiter(5 * 60_000, 10);

/**
 * POST /api/bank-sync/callback  { state, code?, error? }
 *
 * The callback page relays what the bank put in the redirect URL (and has
 * already wiped it from the address bar). The state must match — by hash —
 * a trip THIS user started in THIS session, unexpired and unused; it is
 * consumed atomically, so a code can only ever be exchanged once and a
 * state can't be replayed or used from another session or account.
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    if (!allow(ids.userId)) return apiError("api.bankRateLimited", 429);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const state = typeof body?.state === "string" ? body.state : "";
    const code = typeof body?.code === "string" ? body.code : "";
    const bankError = typeof body?.error === "string" ? body.error : "";
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(state) || code.length > 2000) {
      return apiError("api.bankAuthStateInvalid", 400);
    }

    const now = new Date().toISOString();
    const [authState] = await db
      .update(bankAuthStates)
      .set({ usedAt: now })
      .where(
        and(
          eq(bankAuthStates.stateHash, createHash("sha256").update(state).digest("hex")),
          eq(bankAuthStates.userId, ids.userId),
          eq(bankAuthStates.sessionId, ids.sessionId),
          isNull(bankAuthStates.usedAt),
          gt(bankAuthStates.expiresAt, now),
        ),
      )
      .returning({ id: bankAuthStates.id, purpose: bankAuthStates.purpose });
    const meta = getRequestMeta(request.headers);
    if (!authState) {
      logDataEvent({ userId: ids.userId, action: "bank_callback_rejected", targetType: "bank_auth_state", ...meta });
      return apiError("api.bankAuthStateInvalid", 400);
    }

    if (bankError || !code) {
      // Cancelled at the bank (or denied): close the trip for good.
      await db
        .update(bankAuthStates)
        .set({ completedAt: now })
        .where(and(eq(bankAuthStates.id, authState.id), eq(bankAuthStates.userId, ids.userId)));
      return apiError("api.bankAuthCancelled", 400);
    }

    const requestId = await enqueueJob(ids.userId, "bank.complete_auth", { authStateId: authState.id, code }, {
      priority: JOB_PRIORITY.interactive,
      maxAttempts: 2,
    });
    logDataEvent({
      userId: ids.userId,
      action: "bank_callback_accepted",
      targetId: authState.id,
      targetType: "bank_auth_state",
      details: { purpose: authState.purpose },
      ...meta,
    });
    return NextResponse.json({ requestId, purpose: authState.purpose }, { status: 202 });
  }, "Failed to handle bank callback");
}
