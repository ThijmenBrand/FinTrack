import { createPrivateKey, type KeyObject } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections, bankCredentials, type BankConnection, type BankCredential } from "@/db/schema";
import { EnableBankingClient, type FetchLike } from "../enable-banking/client";
import { aadFor, open, seal } from "../crypto/secret-box";
import { loadKeyRing } from "../crypto/kek";
import { bug, retry, userAction } from "../errors";
import { isJobErrorCode } from "@/lib/jobs/types";

/**
 * Turning stored, encrypted credentials into a working API client — the one
 * place a private key is ever decrypted. Every lookup is scoped to the job's
 * user: a job can only ever reach its own user's credential.
 */

/** Tests swap the network out here. */
let fetchImpl: FetchLike | undefined;
export function setFetchForTests(f: FetchLike | undefined) {
  fetchImpl = f;
  keyCache.clear();
}

// Decrypted keys are kept in memory for at most five minutes, keyed by the
// ciphertext itself so a regenerated credential can never hit a stale entry.
const KEY_CACHE_MS = 5 * 60_000;
const keyCache = new Map<string, { key: KeyObject; at: number }>();

function privateKeyFor(credential: BankCredential): KeyObject {
  const cacheKey = `${credential.id}:${credential.privateKeyEnc}`;
  const hit = keyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < KEY_CACHE_MS) return hit.key;
  const pem = open(
    loadKeyRing(),
    credential.privateKeyEnc,
    aadFor("bank_private_key", credential.userId, credential.id),
  );
  const key = createPrivateKey(pem);
  for (const [k, v] of keyCache) if (Date.now() - v.at >= KEY_CACHE_MS) keyCache.delete(k);
  keyCache.set(cacheKey, { key, at: Date.now() });
  return key;
}

export async function loadCredential(userId: string, opts: { requireVerified: boolean }) {
  const [credential] = await db
    .select()
    .from(bankCredentials)
    .where(eq(bankCredentials.userId, userId))
    .limit(1);
  if (!credential) throw userAction("not_found", "No bank credential set up");
  if (!credential.appId) throw userAction("app_not_found", "Application id not set yet");
  if (opts.requireVerified && credential.status !== "verified") {
    // Mid-verification is a moment, not a verdict: try again shortly rather
    // than marking anything broken.
    if (credential.status === "verifying") throw retry("provider_unavailable", "Credential is being verified");
    throw userAction(
      isJobErrorCode(credential.lastErrorCode) ? credential.lastErrorCode : "key_rejected",
      "Bank credential is not verified",
    );
  }
  if (Date.parse(credential.certificateNotAfter) < Date.now()) {
    throw userAction("certificate_expired", "The application certificate has expired");
  }
  return credential;
}

export function clientFor(credential: BankCredential): EnableBankingClient {
  if (!credential.appId) throw bug("internal", "Credential without application id");
  return new EnableBankingClient({
    appId: credential.appId,
    privateKey: privateKeyFor(credential),
    fetch: fetchImpl,
  });
}

export async function loadConnection(userId: string, connectionId: string): Promise<BankConnection> {
  const [connection] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)))
    .limit(1);
  if (!connection) throw userAction("not_found", "Bank connection not found");
  return connection;
}

export function sessionIdOf(connection: BankConnection): string {
  if (!connection.sessionIdEnc) throw userAction("consent_revoked", "Connection has no session");
  return open(
    loadKeyRing(),
    connection.sessionIdEnc,
    aadFor("bank_session_id", connection.userId, connection.id),
  );
}

export function sealSessionId(userId: string, connectionId: string, sessionId: string): string {
  return seal(loadKeyRing(), sessionId, aadFor("bank_session_id", userId, connectionId));
}

export function sealPrivateKey(userId: string, credentialId: string, pem: string): string {
  return seal(loadKeyRing(), pem, aadFor("bank_private_key", userId, credentialId));
}
