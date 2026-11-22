/**
 * The prefix better-auth puts in front of its cookie names
 * (`<prefix>.session_token`, `<prefix>.session_data`, …).
 *
 * Cookies are scoped by HOST, not by port: two dev servers on localhost —
 * two worktrees, say — share one cookie jar, so each one's sign-in overwrites
 * the other's session token, and the next request to the evicted app is a 401
 * that clears the cookie for both. Give each local checkout its own
 * `AUTH_COOKIE_PREFIX` and they stop treading on each other.
 *
 * Default "better-auth", which is better-auth's own, so production and any
 * existing session are untouched.
 *
 * It lives apart from `@/lib/auth` because the proxy needs the cookie NAMES
 * without pulling in the whole auth instance.
 */
const DEFAULT_PREFIX = "better-auth";

/** What a cookie name may hold: no separators, spaces or control characters. */
const VALID_PREFIX = /^[A-Za-z0-9_-]+$/;

export const AUTH_COOKIE_PREFIX = resolvePrefix();

function resolvePrefix(): string {
  const configured = process.env.AUTH_COOKIE_PREFIX?.trim();
  if (!configured) return DEFAULT_PREFIX;
  if (!VALID_PREFIX.test(configured)) {
    // A bad prefix doesn't fail loudly on its own — it yields a cookie no
    // browser sends back, i.e. a login that silently never sticks. Say so.
    throw new Error(
      `AUTH_COOKIE_PREFIX must match ${VALID_PREFIX} — got "${configured}".`,
    );
  }
  return configured;
}

/** Every cookie better-auth may have set for a session, plain and __Secure-. */
export function authCookieNames(): string[] {
  return ["session_token", "session_data"].flatMap((name) => [
    `${AUTH_COOKIE_PREFIX}.${name}`,
    `__Secure-${AUTH_COOKIE_PREFIX}.${name}`,
  ]);
}
