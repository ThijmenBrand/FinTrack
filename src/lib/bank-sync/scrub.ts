/**
 * Scrubbing for everything that leaves the process for Sentry (errors, logs,
 * spans, breadcrumbs). Bank sync handles material that must never end up in a
 * third-party error tracker: account numbers, OAuth codes and states, signed
 * tokens, private keys, and provider ids in Enable Banking URLs.
 *
 * Pattern-based and deliberately greedy — a false positive costs a less useful
 * stack trace, a false negative costs a leak.
 */

const RULES: Array<[RegExp, string]> = [
  // PEM blocks (private keys, certificates).
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[pem]"],
  // Bearer tokens and bare JWTs.
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]"],
  // OAuth parameters in URLs and bodies.
  [/([?&#]|\b)(code|state|continuation_key|session_id)=[^&\s"'#]*/gi, "$1$2=[redacted]"],
  [/"(code|state|session_id|sessionId|continuation_key|uid|externalUid)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"'],
  // Enable Banking paths carry account and session ids.
  [/(\/(?:accounts|sessions))\/[A-Za-z0-9-]+/g, "$1/[id]"],
  // IBANs, spaced or not.
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/g, "[iban]"],
  // Our own ciphertexts.
  [/\bv\d+:[A-Za-z0-9_-]{24,}\b/g, "[sealed]"],
];

export function scrubText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

const SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|code|state|session_?id|private_?key|certificate|psu-ip-address|psu-user-agent)$/i;

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubValue(value[i], depth + 1, seen);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = SENSITIVE_KEYS.test(key) ? "[redacted]" : scrubValue(obj[key], depth + 1, seen);
  }
  return obj;
}

/**
 * Scrub a Sentry event / log / span in place and return it. Typed loosely so
 * one function serves beforeSend, beforeSendLog and beforeSendSpan alike.
 */
export function scrubEvent<T>(event: T): T {
  return scrubValue(event, 0, new WeakSet()) as T;
}
