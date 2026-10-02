import fs from "node:fs";

/** Where the worker container gets its master key (a Docker secret). */
export const DEFAULT_KEK_FILE = "/run/secrets/bank_kek";

/**
 * The web app must never be able to decrypt bank keys: that is the whole
 * point of running the worker separately. Refuse to start in production when
 * this process can see the master key — a compose file that mounts the
 * secret into the wrong service fails loudly instead of quietly weakening
 * the design. In development, only warn: web and worker share a machine.
 */
export function assertWebHasNoBankKey(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];
  if (env.BANK_SYNC_KEK_FILE) problems.push("BANK_SYNC_KEK_FILE is set");
  if (env.BANK_KEK) problems.push("BANK_KEK is set");
  try {
    fs.accessSync(env.BANK_SYNC_KEK_FILE || DEFAULT_KEK_FILE, fs.constants.R_OK);
    problems.push("the bank-sync master key file is readable");
  } catch {
    // Not readable: as it should be.
  }
  if (problems.length === 0) return;
  const message = `The web process can reach the bank-sync master key (${problems.join(", ")}). Only the worker container may.`;
  if (env.NODE_ENV === "production") throw new Error(message);
  console.warn(`[bank-sync] ${message} (allowed in development)`);
}
