/**
 * The parts of the idle lock the browser needs too — kept apart from
 * src/lib/session-lock.ts, which reaches the database.
 */

/** The machine-readable `code` a locked API request answers with. */
export const SESSION_LOCKED_CODE = "session_locked";

/** The lock screen, set to return to `returnTo` once unlocked. */
export function unlockPath(returnTo: string): string {
  return returnTo === "/" ? "/unlock" : `/unlock?redirect=${encodeURIComponent(returnTo)}`;
}
