import { describe, it, expect } from "vitest";
import { validatePattern, MAX_PATTERN_LENGTH, sanitizeNote, MAX_NOTE_LENGTH } from "./validation";

describe("sanitizeNote", () => {
  it("returns null for non-string input", () => {
    expect(sanitizeNote(null)).toBeNull();
    expect(sanitizeNote(undefined)).toBeNull();
    expect(sanitizeNote(42)).toBeNull();
    expect(sanitizeNote({})).toBeNull();
  });

  it("returns null for empty / whitespace-only strings", () => {
    expect(sanitizeNote("")).toBeNull();
    expect(sanitizeNote("   \n\t")).toBeNull();
  });

  it("trims and returns a normal note", () => {
    expect(sanitizeNote("  lunch with Sam  ")).toBe("lunch with Sam");
  });

  it("caps at MAX_NOTE_LENGTH characters", () => {
    expect(sanitizeNote("a".repeat(MAX_NOTE_LENGTH + 50))).toBe(
      "a".repeat(MAX_NOTE_LENGTH)
    );
  });
});

describe("validatePattern", () => {
  it("rejects non-string input", () => {
    expect(validatePattern(123)).toEqual({
      ok: false,
      error: "Pattern must be a string",
    });
    expect(validatePattern(null)).toEqual({
      ok: false,
      error: "Pattern must be a string",
    });
    expect(validatePattern(undefined)).toEqual({
      ok: false,
      error: "Pattern must be a string",
    });
    expect(validatePattern({})).toEqual({
      ok: false,
      error: "Pattern must be a string",
    });
  });

  it("rejects empty / whitespace-only strings", () => {
    expect(validatePattern("")).toMatchObject({ ok: false });
    expect(validatePattern("   ")).toMatchObject({ ok: false });
    expect(validatePattern("\t\n")).toMatchObject({ ok: false });
  });

  it("trims and accepts a normal string", () => {
    expect(validatePattern("  hello  ")).toEqual({ ok: true, value: "hello" });
  });

  it("accepts a pattern of exactly MAX_PATTERN_LENGTH after trimming", () => {
    const pattern = "a".repeat(MAX_PATTERN_LENGTH);
    expect(validatePattern(pattern)).toEqual({ ok: true, value: pattern });
  });

  it("rejects a pattern of MAX_PATTERN_LENGTH + 1 after trimming", () => {
    const pattern = "a".repeat(MAX_PATTERN_LENGTH + 1);
    expect(validatePattern(pattern)).toEqual({
      ok: false,
      error: `Pattern must be ${MAX_PATTERN_LENGTH} characters or fewer`,
    });
  });

  it("counts length after trimming, not before", () => {
    // 200 'a's plus 5 surrounding spaces → trimmed length = 200 → ok
    const padded = "  " + "a".repeat(MAX_PATTERN_LENGTH) + "   ";
    expect(validatePattern(padded)).toMatchObject({ ok: true });
  });
});
