import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the secrets bank sync keeps at rest (users' private keys,
 * Enable Banking session ids).
 *
 * Format: `v<version>:<base64url(iv ‖ tag ‖ ciphertext)>`, 96-bit random IV,
 * 128-bit tag. The version names the master key that sealed it, so the master
 * key can be rotated (scripts/rotate-bank-kek.ts) without a flag day.
 *
 * Every value is sealed with associated data naming what it is and whose it is
 * (`purpose|userId|rowId`). A ciphertext copied into another user's row — or
 * from the session column into the key column — fails authentication instead
 * of decrypting.
 *
 * Lives under src/worker: the web app can neither import this nor read the
 * master key it needs (see the ESLint boundary and src/worker/crypto/kek.ts).
 */

export interface KeyRing {
  /** Seals new values. */
  current: { version: number; key: Buffer };
  /** Older keys still accepted for opening, by version. */
  previous: Map<number, Buffer>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

export type SecretPurpose = "bank_private_key" | "bank_session_id";

export function aadFor(purpose: SecretPurpose, userId: string, rowId: string): Buffer {
  return Buffer.from(`${purpose}|${userId}|${rowId}`, "utf8");
}

export function seal(ring: KeyRing, plaintext: string, aad: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${ring.current.version}:${Buffer.concat([iv, tag, body]).toString("base64url")}`;
}

export class SecretBoxError extends Error {}

export function open(ring: KeyRing, sealed: string, aad: Buffer): string {
  const match = /^v(\d+):([A-Za-z0-9_-]+)$/.exec(sealed);
  if (!match) throw new SecretBoxError("Malformed ciphertext");
  const version = Number(match[1]);
  const key =
    version === ring.current.version ? ring.current.key : ring.previous.get(version);
  if (!key) throw new SecretBoxError(`No master key for v${version}`);
  const raw = Buffer.from(match[2], "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new SecretBoxError("Malformed ciphertext");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong row, or tampered — indistinguishable on purpose.
    throw new SecretBoxError("Ciphertext failed authentication");
  }
}

/** Whether a value is sealed with an older master key and should be re-sealed. */
export function needsReseal(ring: KeyRing, sealed: string): boolean {
  const match = /^v(\d+):/.exec(sealed);
  return !!match && Number(match[1]) !== ring.current.version;
}
