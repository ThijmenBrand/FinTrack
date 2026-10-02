import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAccountLinks, bankConnections, bankCredentials } from "@/db/schema";
import { allowSandbox, bankSyncRedirectUrl } from "@/lib/bank-sync/config";
import { logDataEvent } from "@/lib/audit";
import { notifyBankEvent } from "@/lib/bank-sync/notify";
import { generateCredential } from "../crypto/certificate";
import { clientFor, loadCredential, sealPrivateKey, sessionIdOf } from "../bank-sync/context";
import { JobError, bug, userAction } from "../errors";
import { payloadString, type Handler } from "./types";

/**
 * Generate the user's key pair and certificate. The private key is sealed
 * before it is written anywhere; only the certificate (public) is readable by
 * the web app. An earlier credential is replaced only while nothing hangs off
 * it (never verified, or no connections); otherwise it has to be deleted
 * first, which revokes its consents at the bank.
 */
export const generateCredentialHandler: Handler<"bank.generate_credential"> = async (_payload, ctx) => {
  const [existing] = await db
    .select({ id: bankCredentials.id, status: bankCredentials.status })
    .from(bankCredentials)
    .where(eq(bankCredentials.userId, ctx.userId))
    .limit(1);
  if (existing) {
    const [connection] = await db
      .select({ id: bankConnections.id })
      .from(bankConnections)
      .where(and(eq(bankConnections.credentialId, existing.id), eq(bankConnections.userId, ctx.userId)))
      .limit(1);
    if (existing.status === "verified" || connection) {
      throw bug("invalid_payload", "A credential in use exists; delete it first");
    }
  }

  const generated = await generateCredential();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .delete(bankCredentials)
        .where(and(eq(bankCredentials.id, existing.id), eq(bankCredentials.userId, ctx.userId)));
    }
    await tx.insert(bankCredentials).values({
      id,
      userId: ctx.userId,
      certificatePem: generated.certificatePem,
      certificateFingerprint: generated.fingerprint,
      certificateNotAfter: generated.notAfter.toISOString(),
      privateKeyEnc: sealPrivateKey(ctx.userId, id, generated.privateKeyPem),
      status: "pending_app_id",
      createdAt: now,
      updatedAt: now,
    });
  });
  logDataEvent({
    userId: ctx.userId,
    action: "bank_credential_generated",
    targetId: id,
    targetType: "bank_credential",
    details: { fingerprint: generated.fingerprint },
  });
  await notifyBankEvent(ctx.userId, "credentialGenerated");
  return { credentialId: id };
};

/**
 * Check the user's Enable Banking application with a signed call: the key is
 * accepted, the application is live, it is a production application, and it
 * lists our redirect URL. Anything off is reported precisely, so the user
 * knows which field in Enable Banking to fix.
 */
export const verifyCredentialHandler: Handler<"bank.verify_credential"> = async (payload, ctx) => {
  const credentialId = payloadString(payload, "credentialId");
  const credential = await loadCredential(ctx.userId, { requireVerified: false });
  if (credential.id !== credentialId) throw userAction("not_found", "Credential was replaced");

  const setStatus = (status: "verified" | "invalid", code: string | null) =>
    db
      .update(bankCredentials)
      .set({
        status,
        lastErrorCode: code,
        verifiedAt: status === "verified" ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(bankCredentials.id, credential.id), eq(bankCredentials.userId, ctx.userId)));

  try {
    const app = await clientFor(credential).getApplication();
    if (!app.active) throw userAction("app_inactive", "The application is not active yet");
    if (app.environment !== "PRODUCTION" && !allowSandbox()) {
      throw userAction("wrong_environment", "The application is not a production application");
    }
    if (!app.redirectUrls.includes(bankSyncRedirectUrl())) {
      throw userAction("redirect_url_missing", "The application does not list FinTrack's redirect URL");
    }
  } catch (err) {
    if (err instanceof JobError && err.kind === "user_action") await setStatus("invalid", err.code);
    throw err;
  }
  await setStatus("verified", null);
  return { status: "verified" };
};

/**
 * Remove the credential for good: revoke every consent at the bank first
 * (while we still hold the key that can), then delete the row — which
 * crypto-shreds the key — with its connections and their links. Transactions
 * stay.
 */
export const deleteCredentialHandler: Handler<"bank.delete_credential"> = async (payload, ctx) => {
  const credentialId = payloadString(payload, "credentialId");
  const [credential] = await db
    .select()
    .from(bankCredentials)
    .where(and(eq(bankCredentials.id, credentialId), eq(bankCredentials.userId, ctx.userId)))
    .limit(1);
  if (!credential) return { deleted: false };

  const connections = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.credentialId, credential.id), eq(bankConnections.userId, ctx.userId)));
  if (credential.appId && connections.length > 0) {
    const client = clientFor(credential);
    for (const connection of connections) {
      if (!connection.sessionIdEnc || connection.status !== "active") continue;
      try {
        await client.deleteSession(sessionIdOf(connection));
      } catch (err) {
        // A network hiccup is worth a retry — revoking is the point. A key
        // or consent the provider no longer accepts can't be revoked by us
        // anyway; deleting locally is all that is left.
        if (err instanceof JobError && (err.kind === "retry" || err.kind === "rate_limited")) throw err;
      }
    }
  }

  // Explicit rather than trusting ON DELETE CASCADE: hosted libsql doesn't
  // guarantee foreign_keys=ON (see transactions.parentTransactionId).
  await db.transaction(async (tx) => {
    for (const connection of connections) {
      await tx
        .delete(bankAccountLinks)
        .where(and(eq(bankAccountLinks.connectionId, connection.id), eq(bankAccountLinks.userId, ctx.userId)));
    }
    await tx
      .delete(bankConnections)
      .where(and(eq(bankConnections.credentialId, credential.id), eq(bankConnections.userId, ctx.userId)));
    await tx
      .delete(bankCredentials)
      .where(and(eq(bankCredentials.id, credential.id), eq(bankCredentials.userId, ctx.userId)));
  });
  logDataEvent({
    userId: ctx.userId,
    action: "bank_credential_deleted",
    targetId: credential.id,
    targetType: "bank_credential",
    details: { connectionsRevoked: connections.length },
  });
  return { deleted: true };
};
