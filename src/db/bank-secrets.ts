import { and, eq, isNotNull } from "drizzle-orm";
import { adminDb } from "./index";
import { bankConnections, bankCredentials } from "./schema";

/**
 * Cross-user access to the sealed bank-sync columns, for master-key rotation
 * only (src/worker/rotate-kek.ts). Returns ciphertext; nothing here can open it.
 */

export async function allSealedSecrets() {
  const credentials = await adminDb
    .select({ id: bankCredentials.id, userId: bankCredentials.userId, sealed: bankCredentials.privateKeyEnc })
    .from(bankCredentials);
  const sessions = await adminDb
    .select({ id: bankConnections.id, userId: bankConnections.userId, sealed: bankConnections.sessionIdEnc })
    .from(bankConnections)
    .where(isNotNull(bankConnections.sessionIdEnc));
  return { credentials, sessions: sessions as Array<{ id: string; userId: string; sealed: string }> };
}

/** Swap one ciphertext for another, only if it is still the one we read. */
export async function replaceSealedCredential(id: string, userId: string, from: string, to: string) {
  await adminDb
    .update(bankCredentials)
    .set({ privateKeyEnc: to })
    .where(and(eq(bankCredentials.id, id), eq(bankCredentials.userId, userId), eq(bankCredentials.privateKeyEnc, from)));
}

export async function replaceSealedSession(id: string, userId: string, from: string, to: string) {
  await adminDb
    .update(bankConnections)
    .set({ sessionIdEnc: to })
    .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, userId), eq(bankConnections.sessionIdEnc, from)));
}
