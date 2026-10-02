import fs from "node:fs";
import type { KeyRing } from "./secret-box";
import { DEFAULT_KEK_FILE } from "@/lib/bank-sync/process-guard";

/**
 * The bank-sync master key ("KEK"): 32 random bytes, base64, in a file that is
 * mounted into the WORKER container only (Docker secret, mode 0400). The web
 * container has no such mount and refuses to start if it can see one — see
 * src/lib/bank-sync/process-guard.ts.
 *
 *   BANK_SYNC_KEK_FILE            current key   (default /run/secrets/bank_kek)
 *   BANK_SYNC_KEK_VERSION         its version   (default 1)
 *   BANK_SYNC_KEK_PREVIOUS_FILE   key being rotated away from (optional)
 *   BANK_SYNC_KEK_PREVIOUS_VERSION
 *
 * Generate one with: openssl rand -base64 32
 */

export class KekError extends Error {}

function readKey(file: string): Buffer {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8").trim();
  } catch {
    throw new KekError(`Bank sync master key not readable at ${file}`);
  }
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text.replace(/\s/g, "")) {
    throw new KekError("Bank sync master key must be exactly 32 bytes, base64-encoded");
  }
  return key;
}

function readVersion(raw: string | undefined, fallback: number): number {
  const v = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(v) || v < 1 || v > 9999) throw new KekError("Invalid master key version");
  return v;
}

let ring: KeyRing | null = null;

/** Load (once) and return the worker's key ring. Throws if the key is missing or malformed. */
export function loadKeyRing(env: NodeJS.ProcessEnv = process.env): KeyRing {
  if (ring) return ring;
  const current = {
    version: readVersion(env.BANK_SYNC_KEK_VERSION, 1),
    key: readKey(env.BANK_SYNC_KEK_FILE || DEFAULT_KEK_FILE),
  };
  const previous = new Map<number, Buffer>();
  if (env.BANK_SYNC_KEK_PREVIOUS_FILE) {
    const version = readVersion(env.BANK_SYNC_KEK_PREVIOUS_VERSION, current.version - 1);
    if (version === current.version) throw new KekError("Previous master key needs its own version");
    previous.set(version, readKey(env.BANK_SYNC_KEK_PREVIOUS_FILE));
  }
  ring = { current, previous };
  return ring;
}

/** Tests only. */
export function setKeyRingForTests(r: KeyRing | null): void {
  ring = r;
}
