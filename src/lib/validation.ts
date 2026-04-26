export const MAX_PATTERN_LENGTH = 200;

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
