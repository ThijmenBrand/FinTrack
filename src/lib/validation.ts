export const MAX_PATTERN_LENGTH = 200;
export const MAX_NOTE_LENGTH = 500;

/** True for a finite number — rejects NaN, ±Infinity, strings, null. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** True for a YYYY-MM-DD string naming a real calendar date. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export const MATCH_TYPES = ["contains", "exact", "starts_with"] as const;
export type RuleMatchType = (typeof MATCH_TYPES)[number];

/** Allowlist check for category-rule match types (CLAUDE.md requirement). */
export function isMatchType(v: unknown): v is RuleMatchType {
  return typeof v === "string" && (MATCH_TYPES as readonly string[]).includes(v);
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

/** Trimmed, non-empty, length-capped username / display name. */
export function validateName(input: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, error: "Value cannot be empty" };
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: `Value must be ${MAX_USERNAME_LENGTH} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

/** Trim and cap a user-supplied transaction note. Returns null for empty or non-string input. */
export function sanitizeNote(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed || null;
}

export type PatternValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validatePattern(pattern: unknown): PatternValidation {
  if (typeof pattern !== "string") {
    return { ok: false, error: "Pattern must be a string" };
  }
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Pattern cannot be empty" };
  }
  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `Pattern must be ${MAX_PATTERN_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, value: trimmed };
}
