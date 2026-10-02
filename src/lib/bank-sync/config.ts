/**
 * Bank-sync settings both processes agree on. No secrets here — the web app
 * imports this to show the user what to paste into Enable Banking, the worker
 * to make the same promises to the provider.
 */

/** Base URL of the app, as better-auth sees it (BETTER_AUTH_URL). */
function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Where the bank sends the user back. Must be registered verbatim in the
 * user's Enable Banking application — the worker refuses to verify an
 * application that doesn't list it.
 */
export function bankSyncRedirectUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${appBaseUrl(env)}/settings/bank-connections/callback`;
}

/** Enable Banking sandbox applications are accepted only when this is set (local development). */
export function allowSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BANK_SYNC_ALLOW_SANDBOX === "1";
}

/** Background syncs per link: one every 6 h stays under PSD2's usual 4 unattended reads a day. */
export const SYNC_INTERVAL_MS = 6 * 3_600_000;

/** A sync re-reads this many days before the newest booking it has, for late bookings. */
export const SYNC_OVERLAP_DAYS = 5;

/** Longest consent we ask for; banks cap it (most at 180 days). */
export const MAX_CONSENT_DAYS = 180;

/** How long one trip to the bank (and the mapping screen after it) may take. */
export const AUTH_STATE_TTL_MS = 30 * 60_000;

/** Warn about a consent or certificate this long before it ends. */
export const EXPIRY_WARNING_MS = 14 * 86_400_000;

/** At most this many bank connections per user. */
export const MAX_CONNECTIONS_PER_USER = 10;

/** The heartbeat is written every 30 s; older than this means the worker is down. */
export const WORKER_STALE_MS = 2 * 60_000;

/** Countries Enable Banking serves that the bank picker offers. */
export const BANK_SYNC_COUNTRIES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR",
  "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO",
  "SE", "SI", "SK",
] as const;
export type BankSyncCountry = (typeof BANK_SYNC_COUNTRIES)[number];

export function isBankSyncCountry(v: unknown): v is BankSyncCountry {
  return typeof v === "string" && (BANK_SYNC_COUNTRIES as readonly string[]).includes(v);
}

/** Enable Banking application ids are UUIDs. */
export function isAppId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
