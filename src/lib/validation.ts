import type { MessageKey, Vars } from "@/lib/i18n/translate";

/**
 * A rejected value, as a message key rather than English prose — the caller
 * hands it to `apiError`, which renders it in the requester's language.
 */
export interface ValidationFailure {
  ok: false;
  error: MessageKey;
  vars?: Vars;
}

export const MAX_PATTERN_LENGTH = 200;
export const MAX_NOTE_LENGTH = 500;

/** True for a finite number — rejects NaN, ±Infinity, strings, null. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Half a cent. Money is stored as a float, so sums that should be equal can
 * differ in the last bits — compare against this rather than exactly whenever
 * a total is checked against a cap.
 */
export const MONEY_EPSILON = 0.005;

/** True for a YYYY-MM-DD string naming a real calendar date. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * True for a `#rgb` or `#rrggbb` colour.
 *
 * Every colour the app writes comes from a native colour input or the seeded
 * palette, and every colour it reads goes into a `style` object — an allowlist
 * of the one format both ends already speak, rather than trusting whatever a
 * client sends to be something CSS can make sense of.
 */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

export const MATCH_TYPES = ["contains", "exact", "starts_with"] as const;
export type RuleMatchType = (typeof MATCH_TYPES)[number];

/** Allowlist check for category-rule match types (CLAUDE.md requirement). */
export function isMatchType(v: unknown): v is RuleMatchType {
  return typeof v === "string" && (MATCH_TYPES as readonly string[]).includes(v);
}

/** Which transaction text a rule matches against. "both" = "name — description". */
export const MATCH_FIELDS = ["both", "name", "description"] as const;
export type RuleMatchField = (typeof MATCH_FIELDS)[number];

export function isMatchField(v: unknown): v is RuleMatchField {
  return typeof v === "string" && (MATCH_FIELDS as readonly string[]).includes(v);
}

export const MAX_USERNAME_LENGTH = 50;
export const MIN_PASSWORD_LENGTH = 10;

// Common passwords list (top entries from breached password databases)
const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "1234567890", "qwerty",
  "abc123", "monkey", "1234567", "letmein", "trustno1",
  "dragon", "baseball", "iloveyou", "master", "sunshine",
  "ashley", "michael", "shadow", "123123", "654321",
  "superman", "qazwsx", "football", "password1", "password123",
  "welcome", "welcome1", "p@ssw0rd", "passw0rd", "admin",
  "administrator", "login", "hello", "charlie", "donald",
  "starwars", "access", "master1", "qwerty123", "mustang",
  "121212", "bailey", "freedom", "shadow1", "passpass",
  "whatever", "qwer1234", "zaq1zaq1", "000000", "111111",
  "1q2w3e4r", "zaq12wsx", "1qaz2wsx", "abcdefgh", "changeme",
]);

/**
 * Shared password policy for every path that sets a password (profile change,
 * admin create/reset). Returns an error message or null when acceptable.
 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "This password is too common. Please choose a more unique password.";
  }
  return null;
}

export const MAX_EMAIL_LENGTH = 254;

/**
 * Validate a signup email. Returns an error message or null when acceptable.
 * Rejects the reserved `@local` suffix used by legacy synthetic accounts.
 */
export function validateEmail(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) {
    return "Email is required";
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return `Email must be ${MAX_EMAIL_LENGTH} characters or fewer`;
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ||
    trimmed.endsWith("@local") ||
    trimmed.endsWith("@local.test")
  ) {
    return "Enter a valid email address";
  }
  return null;
}

/** Trimmed, non-empty, length-capped display name. */
export function validateName(input: unknown): { ok: true; value: string } | ValidationFailure {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, error: "api.nameEmpty" };
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: "api.nameTooLong", vars: { max: MAX_USERNAME_LENGTH } };
  }
  return { ok: true, value: trimmed };
}

export const MAX_FEEDBACK_LENGTH = 2000;

/** Trimmed, non-empty, length-capped feedback message. */
export function validateFeedback(
  input: unknown,
): { ok: true; value: string } | ValidationFailure {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, error: "api.feedbackEmpty" };
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_FEEDBACK_LENGTH) {
    return {
      ok: false,
      error: "api.feedbackTooLong",
      vars: { max: MAX_FEEDBACK_LENGTH },
    };
  }
  return { ok: true, value: trimmed };
}

/** Trim and cap a user-supplied transaction note. Returns null for empty or non-string input. */
export function sanitizeNote(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed || null;
}

/**
 * A post-login `?redirect=` target, or the fallback when it isn't a same-origin
 * path. Both "//" and "/\" parse as an authority — `/\evil.com` resolves to
 * https://evil.com — so a leading-slash check alone is not enough.
 */
export function safeRedirectPath(input: unknown, fallback = "/"): string {
  return typeof input === "string" && /^\/[^/\\]/.test(input) ? input : fallback;
}

export type PatternValidation =
  | { ok: true; value: string }
  | ValidationFailure;

export function validatePattern(pattern: unknown): PatternValidation {
  if (typeof pattern !== "string") {
    return { ok: false, error: "api.patternNotString" };
  }
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "api.patternEmpty" };
  }
  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: "api.patternTooLong",
      vars: { max: MAX_PATTERN_LENGTH },
    };
  }
  return { ok: true, value: trimmed };
}
