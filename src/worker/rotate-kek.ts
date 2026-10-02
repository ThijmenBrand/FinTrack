import { allSealedSecrets, replaceSealedCredential, replaceSealedSession } from "@/db/bank-secrets";
import { aadFor, needsReseal, open, seal, type KeyRing } from "./crypto/secret-box";

/**
 * Re-seal every bank-sync secret under the current master key.
 *
 *   1. put the new key next to the old one; start the worker with
 *        BANK_SYNC_KEK_FILE=<new>  BANK_SYNC_KEK_VERSION=<n+1>
 *        BANK_SYNC_KEK_PREVIOUS_FILE=<old>  BANK_SYNC_KEK_PREVIOUS_VERSION=<n>
 *      (it reads both, writes with the new one)
 *   2. run `node dist/worker.mjs rotate-kek` with the same environment
 *   3. once it reports 0 left, drop the PREVIOUS_* settings and destroy the old key
 *
 * Plaintext only ever exists in this process's memory, one value at a time.
 */
export async function rotateKek(ring: KeyRing): Promise<{ resealed: number; failed: number }> {
  const { credentials, sessions } = await allSealedSecrets();
  let resealed = 0;
  let failed = 0;
  const work = [
    ...credentials.map((r) => ({ ...r, purpose: "bank_private_key" as const, replace: replaceSealedCredential })),
    ...sessions.map((r) => ({ ...r, purpose: "bank_session_id" as const, replace: replaceSealedSession })),
  ];
  for (const row of work) {
    if (!needsReseal(ring, row.sealed)) continue;
    try {
      const aad = aadFor(row.purpose, row.userId, row.id);
      await row.replace(row.id, row.userId, row.sealed, seal(ring, open(ring, row.sealed, aad), aad));
      resealed++;
    } catch {
      failed++;
    }
  }
  return { resealed, failed };
}
