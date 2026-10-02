import type { JobType } from "@/db/schema";

/**
 * Shared vocabulary of the job queue: what each job type carries, and the
 * stable error codes the worker records. Imported by the web app (to enqueue
 * and to show outcomes) and by the worker (to run) — so nothing here may pull
 * in either side's runtime.
 */

/** Lower runs first. A person waiting on the screen beats background sync. */
export const JOB_PRIORITY = { interactive: 0, background: 10 } as const;

/** PSD2 asks the bank to tell an attended request (user present) apart. */
export interface PsuHeaders {
  ip: string;
  userAgent: string;
}

/**
 * Payload per job type. Ids only — never a key, a provider session id or bank
 * data. The two short-lived exceptions (the OAuth code, the PSU headers) are
 * dropped by `scrubPayload` the moment a job stops running.
 */
export interface JobPayloads {
  "bank.generate_credential": Record<string, never>;
  "bank.verify_credential": { credentialId: string };
  "bank.list_aspsps": { country: string };
  "bank.start_auth": {
    sessionId: string;
    purpose: "connect" | "reconnect";
    aspspName: string;
    aspspCountry: string;
    /** The connection a reconnect renews. */
    connectionId?: string;
  };
  "bank.complete_auth": { authStateId: string; code: string };
  "bank.sync_link": { linkId: string; psu?: PsuHeaders };
  "bank.revoke_session": { connectionId: string };
  "bank.delete_credential": { credentialId: string };
}

/**
 * Remove the parts of a payload that must not outlive the run: the OAuth
 * authorization code and the user's IP / user agent. What is left is ids,
 * enough for an admin to see what a dead job was about and to replay it.
 */
export function scrubPayload(type: JobType, payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  if (type === "bank.complete_auth") delete out.code;
  if (type === "bank.sync_link") delete out.psu;
  return out;
}

/**
 * Stable error codes. Stored on jobs, connections, credentials and links, and
 * translated in the UI — the raw provider message never leaves the worker.
 */
export const JOB_ERROR_CODES = [
  // retryable
  "network",
  "timeout",
  "provider_unavailable",
  "db_busy",
  "lease_expired",
  // rate limited (rescheduled, not counted as an attempt)
  "rate_limited",
  // the user has to act
  "key_rejected",
  "app_not_found",
  "app_inactive",
  "redirect_url_missing",
  "wrong_environment",
  "consent_expired",
  "consent_revoked",
  "account_gone",
  "auth_state_invalid",
  "auth_failed",
  "certificate_expired",
  "not_found",
  // bugs / unexpected
  "invalid_payload",
  "invalid_response",
  "internal",
] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

export function isJobErrorCode(v: unknown): v is JobErrorCode {
  return typeof v === "string" && (JOB_ERROR_CODES as readonly string[]).includes(v);
}
