import type { init } from "@sentry/nextjs";

/**
 * `DataCollection` lives in @sentry/core, which isn't a direct dependency, so
 * the type is read off the SDK's own `init` signature. Type-only, so nothing
 * from @sentry/nextjs is pulled into the worker bundle.
 */
type DataCollection = NonNullable<
  NonNullable<Parameters<typeof init>[0]>["dataCollection"]
>;

/**
 * What the Sentry SDK is allowed to collect on its own, for every runtime
 * (browser, server, edge, worker).
 *
 * SDK v11 replaced `sendDefaultPii` with `dataCollection`, and flipped the
 * meaning of leaving it unset: v10 collected little unless you opted in, v11
 * collects almost everything unless you opt out. This is a personal finance
 * app, so every field is set explicitly rather than inherited — the defaults
 * would start shipping cookies, request bodies, query strings and SQL bound
 * parameters to a third-party error tracker.
 *
 * This governs what the SDK *gathers*; `scrubEvent` still runs over whatever
 * does get gathered. Both layers are deliberate: this one stops whole
 * categories at the source, the scrubber catches secrets that leak into an
 * exception message or a span name.
 */
export const DATA_COLLECTION: DataCollection = {
  // No id, email, username or inferred IP address from instrumentation.
  // Anything passed to `Sentry.setUser()` is still sent — we pass nothing.
  userInfo: false,
  // Session cookies and the better-auth token live here.
  cookies: false,
  // Stricter than the v10 default, which sent headers with PII scrubbed:
  // Authorization and Cookie both ride in headers, and v11 renamed the
  // attribute keys, so dropping the category is safer than trusting a filter.
  httpHeaders: false,
  // No request or response bodies, incoming or outgoing: these carry
  // transaction amounts, account numbers and bank API payloads.
  httpBodies: [],
  // Stricter than the v10 default. The bank sends the user back to
  // /settings/bank-connections/callback with a one-time code and state in the
  // query string — the same reason that route sets Referrer-Policy:
  // no-referrer.
  urlQueryParams: false,
  // Bound parameters, write payloads and result rows of every SQL query.
  databaseQueryData: false,
  // Arguments of queued tasks. The bank-sync queue is our own table rather
  // than something Sentry instruments, but the category stays off regardless.
  queues: false,
  // Unused here; set so a later dependency can't quietly switch them on.
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
  // Stricter than the v10 default. Local variables in this app hold decrypted
  // bank secrets, IBANs and session tokens.
  stackFrameVariables: false,
  // v11 lowered the default from 7 to 5; keep the v10 amount of source
  // context, which is our code rather than user data.
  frameContextLines: 7,
};
