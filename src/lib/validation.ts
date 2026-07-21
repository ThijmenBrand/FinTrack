export const MAX_PATTERN_LENGTH = 200;
export const MAX_NOTE_LENGTH = 500;

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
