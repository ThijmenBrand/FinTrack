import { describe, it, expect } from "vitest";
import { validatePattern, MAX_PATTERN_LENGTH } from "./validation";

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
