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

/**
 * Matched against a whole key and against the last dot-separated segment of
 * one. SDK v11 moved request data onto dotted span attributes
 * (`http.request.header.authorization`, `url.query`), so an anchored
 * whole-key test alone would no longer catch them. `dataCollection` already
 * stops these categories at the source; this is the second layer.
 *
 * The list past `psu-user-agent` is that second layer doing its job: the
 * original names covered what the bank API sends us, not what the rest of the
 * app carries. A reset or invite `token`, an `api_key`, a `password` in a
 * failed-request body — all of them reached Sentry under their own names.
 *
 * Separators are `[-_]?` and `x-` is optional because the same name arrives
 * spelled both ways: `api_key` in a JSON body, `x-api-key` as a header — and
 * since v11 that header is a dotted attribute segment, matched by the last
 * segment above. Over-matching here costs a redacted field in a trace; under-
 * matching costs the secret.
 */
const SENSITIVE_KEYS =
  /^(x-)?(authorization|cookie|set-cookie|code|state|session[-_]?id|private[-_]?key|certificate|psu-ip-address|psu-user-agent|(access|refresh|id|api|auth|bearer|csrf|invite|reset|verification)[-_]?token|token|secret|(client|app)[-_]?secret|password|passwd|pwd|passphrase|api[-_]?key|credential(s)?|signature|kek|dek)$/i;

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.test(key)) return true;
  const lastSegment = key.slice(key.lastIndexOf(".") + 1);
  return lastSegment !== key && SENSITIVE_KEYS.test(lastSegment);
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubText(value);
  // Past the cutoff nothing below is looked at, so the value cannot be handed
  // back as it is — a secret nested deeply enough would ride out to Sentry
  // untouched. Drop it instead: a "[too deep]" in a stack trace costs a
  // detail, returning the subtree costs the leak this file exists to stop.
  if (depth > 8) return value === null || typeof value !== "object" ? value : "[too deep]";
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubValue(value[i], depth + 1, seen);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = isSensitiveKey(key) ? "[redacted]" : scrubValue(obj[key], depth + 1, seen);
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
