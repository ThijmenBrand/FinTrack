import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankCredentials } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { createRateLimiter } from "@/lib/rate-limit";

const allow = createRateLimiter(60_000, 3);

/**
 * POST /api/bank-sync/credentials/verify
 * Check the application again — after the user fixed the redirect URL or
 * linked their accounts in Enable Banking. Changes nothing about who can read
 * what, so no step-up; rate-limited instead.
 */
export async function POST() {
  return withUser(async (userId) => {
    if (!allow(userId)) return apiError("api.bankRateLimited", 429);
    const [credential] = await db
      .select({ id: bankCredentials.id, appId: bankCredentials.appId })
      .from(bankCredentials)
      .where(eq(bankCredentials.userId, userId))
      .limit(1);
    if (!credential?.appId) return apiError("api.bankNoCredential", 404);
    await db
      .update(bankCredentials)
      .set({ status: "verifying", updatedAt: new Date().toISOString() })
      .where(and(eq(bankCredentials.id, credential.id), eq(bankCredentials.userId, userId)));
    const requestId = await enqueueJob(userId, "bank.verify_credential", { credentialId: credential.id }, {
      priority: JOB_PRIORITY.interactive,
      dedupeKey: `credential-verify:${userId}`,
      maxAttempts: 3,
    });
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to verify bank credential");
}
