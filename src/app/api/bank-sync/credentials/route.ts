import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections, bankCredentials } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { isAppId } from "@/lib/bank-sync/config";
import { notifyBankEvent } from "@/lib/bank-sync/notify";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { withStepUp } from "@/lib/step-up";

/**
 * POST /api/bank-sync/credentials  (step-up)
 * Have the worker generate a key pair and certificate for this user. Refused
 * while a credential that is in use exists — that one has to be deleted
 * first, which revokes its consents.
 */
export async function POST(request: NextRequest) {
  return withStepUp(async ({ userId }) => {
    const [existing] = await db
      .select({ id: bankCredentials.id, status: bankCredentials.status })
      .from(bankCredentials)
      .where(eq(bankCredentials.userId, userId))
      .limit(1);
    if (existing) {
      const [connection] = await db
        .select({ id: bankConnections.id })
        .from(bankConnections)
        .where(and(eq(bankConnections.credentialId, existing.id), eq(bankConnections.userId, userId)))
        .limit(1);
      if (existing.status === "verified" || connection) return apiError("api.bankCredentialInUse", 409);
    }
    const requestId = await enqueueJob(userId, "bank.generate_credential", {}, {
      priority: JOB_PRIORITY.interactive,
      dedupeKey: `credential-generate:${userId}`,
      maxAttempts: 2,
    });
    logDataEvent({ userId, action: "bank_credential_requested", targetType: "bank_credential", ...getRequestMeta(request.headers) });
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to request bank credential");
}

/**
 * PUT /api/bank-sync/credentials  { appId }  (step-up)
 * Record the Enable Banking application id and have the worker verify it.
 * Changing it on a credential with live connections would silently strand
 * them, so that is refused.
 */
export async function PUT(request: NextRequest) {
  return withStepUp(async ({ userId }) => {
    const body = (await request.json().catch(() => null)) as { appId?: unknown } | null;
    const appId = typeof body?.appId === "string" ? body.appId.trim() : "";
    if (!isAppId(appId)) return apiError("api.bankInvalidAppId", 400);

    const [credential] = await db
      .select()
      .from(bankCredentials)
      .where(eq(bankCredentials.userId, userId))
      .limit(1);
    if (!credential) return apiError("api.bankNoCredential", 404);
    if (credential.appId && credential.appId !== appId) {
      const [connection] = await db
        .select({ id: bankConnections.id })
        .from(bankConnections)
        .where(and(eq(bankConnections.credentialId, credential.id), eq(bankConnections.userId, userId)))
        .limit(1);
      if (connection) return apiError("api.bankCredentialInUse", 409);
    }

    await db
      .update(bankCredentials)
      .set({ appId, status: "verifying", lastErrorCode: null, verifiedAt: null, updatedAt: new Date().toISOString() })
      .where(and(eq(bankCredentials.id, credential.id), eq(bankCredentials.userId, userId)));
    const requestId = await enqueueJob(userId, "bank.verify_credential", { credentialId: credential.id }, {
      priority: JOB_PRIORITY.interactive,
      dedupeKey: `credential-verify:${userId}`,
      maxAttempts: 3,
    });
    logDataEvent({
      userId,
      action: "bank_app_id_set",
      targetId: credential.id,
      targetType: "bank_credential",
      ...getRequestMeta(request.headers),
    });
    if (credential.appId !== appId) await notifyBankEvent(userId, "appIdChanged");
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to set application id");
}

/**
 * DELETE /api/bank-sync/credentials  (step-up)
 * Switch bank sync off: the worker revokes every consent at the bank, then
 * deletes the key (crypto-shredding it) with all connections. Transactions stay.
 */
export async function DELETE(request: NextRequest) {
  return withStepUp(async ({ userId }) => {
    const [credential] = await db
      .select({ id: bankCredentials.id })
      .from(bankCredentials)
      .where(eq(bankCredentials.userId, userId))
      .limit(1);
    if (!credential) return apiError("api.bankNoCredential", 404);
    const requestId = await enqueueJob(userId, "bank.delete_credential", { credentialId: credential.id }, {
      priority: JOB_PRIORITY.interactive,
      dedupeKey: `credential-delete:${userId}`,
    });
    logDataEvent({
      userId,
      action: "bank_credential_delete_requested",
      targetId: credential.id,
      targetType: "bank_credential",
      ...getRequestMeta(request.headers),
    });
    await notifyBankEvent(userId, "credentialsDeleted");
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to delete bank credential");
}
