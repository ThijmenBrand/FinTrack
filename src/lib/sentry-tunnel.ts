/**
 * Where the browser POSTs its Sentry envelopes.
 *
 * next.config.ts turns this into a rewrite to Sentry's ingest endpoint
 * (`tunnelRoute`), so the strict `connect-src 'self'` CSP holds and ad
 * blockers can't drop the request, and src/proxy.ts lets the path through
 * unauthenticated. Both must agree on it, hence the shared constant.
 */
export const SENTRY_TUNNEL_ROUTE = "/monitoring";

/** The rewrite matches with and without a trailing slash; so must the proxy. */
export function isSentryTunnelPath(pathname: string): boolean {
  return pathname === SENTRY_TUNNEL_ROUTE || pathname === `${SENTRY_TUNNEL_ROUTE}/`;
}
