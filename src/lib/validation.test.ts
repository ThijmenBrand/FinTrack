import { describe, it, expect } from "vitest";
import {
  safeRedirectPath,
  validatePattern,
  MAX_PATTERN_LENGTH,
  sanitizeNote,
  MAX_NOTE_LENGTH,
  isFiniteNumber,
  isIsoDate,
  isMatchType,
  isHexColor,
  validatePassword,
  validateName,
  validateEmail,
  validateFeedback,
  MAX_USERNAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_FEEDBACK_LENGTH,
} from "./validation";

describe("validateFeedback", () => {
  it("trims and accepts a message", () => {
    expect(validateFeedback("  the pots page is slow\n ")).toEqual({
      ok: true,
      value: "the pots page is slow",
    });
  });

  it("rejects empty, non-string and over-long input", () => {
    expect(validateFeedback("   ")).toMatchObject({ ok: false });
    expect(validateFeedback(undefined)).toMatchObject({ ok: false });
    expect(validateFeedback("a".repeat(MAX_FEEDBACK_LENGTH + 1))).toMatchObject({
      ok: false,
    });
    expect(validateFeedback("a".repeat(MAX_FEEDBACK_LENGTH))).toMatchObject({
      ok: true,
    });
  });
});

describe("validateEmail", () => {
  it("accepts a normal email and trims whitespace", () => {
    expect(validateEmail("user@example.com")).toBeNull();
    expect(validateEmail("  user@example.com  ")).toBeNull();
  });

  it("rejects missing/invalid shapes", () => {
    expect(validateEmail(undefined)).not.toBeNull();
    expect(validateEmail("")).not.toBeNull();
    expect(validateEmail("no-at-sign.com")).not.toBeNull();
    expect(validateEmail("two@@example.com")).not.toBeNull();
    expect(validateEmail("no-tld@example")).not.toBeNull();
    expect(validateEmail("spaces in@example.com")).not.toBeNull();
  });

  it("rejects the reserved @local suffix", () => {
    expect(validateEmail("admin@local")).not.toBeNull();
  });

  it("rejects overlong emails", () => {
    const long = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
    expect(validateEmail(long)).not.toBeNull();
  });
});

describe("isFiniteNumber", () => {
  it("accepts finite numbers", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-12.5)).toBe(true);
  });

  it("rejects NaN, Infinity, and non-numbers", () => {
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
    expect(isFiniteNumber("12")).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
  });
});

describe("isIsoDate", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(isIsoDate("2026-05-01")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true); // leap day
  });

  it("rejects malformed or impossible dates", () => {
    expect(isIsoDate("2026-5-1")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-05-01T00:00:00Z")).toBe(false);
    expect(isIsoDate(20260501)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("isMatchType", () => {
  it("accepts only the three allowlisted values", () => {
    expect(isMatchType("contains")).toBe(true);
    expect(isMatchType("exact")).toBe(true);
    expect(isMatchType("starts_with")).toBe(true);
    expect(isMatchType("regex")).toBe(false);
    expect(isMatchType("")).toBe(false);
    expect(isMatchType(null)).toBe(false);
  });
});

describe("isHexColor", () => {
  it("accepts the two formats a colour input can produce", () => {
    expect(isHexColor("#3b82f6")).toBe(true);
    expect(isHexColor("#FFF")).toBe(true);
  });

  it("rejects anything else CSS would take", () => {
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("rgb(1,2,3)")).toBe(false);
    expect(isHexColor("#3b82f")).toBe(false);
    expect(isHexColor("3b82f6")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts a long unique password", () => {
    expect(validatePassword("correct horse battery staple")).toBeNull();
  });

  it("rejects short passwords", () => {
    expect(validatePassword("short1")).toMatch(/at least 10/);
    expect(validatePassword(123456)).toMatch(/at least 10/);
  });

  it("rejects common passwords case-insensitively", () => {
    expect(validatePassword("Password123")).toMatch(/too common/);
    expect(validatePassword("1234567890")).toMatch(/too common/);
  });
});

describe("validateName", () => {
  it("trims and accepts a normal name", () => {
    expect(validateName("  thijmen  ")).toEqual({ ok: true, value: "thijmen" });
  });

  it("rejects empty and non-string input", () => {
    expect(validateName("   ")).toMatchObject({ ok: false });
    expect(validateName(42)).toMatchObject({ ok: false });
  });

  it("caps length at MAX_USERNAME_LENGTH", () => {
    expect(validateName("a".repeat(MAX_USERNAME_LENGTH))).toMatchObject({ ok: true });
    expect(validateName("a".repeat(MAX_USERNAME_LENGTH + 1))).toMatchObject({ ok: false });
  });
});

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
      error: "api.patternNotString",
    });
    expect(validatePattern(null)).toEqual({
      ok: false,
      error: "api.patternNotString",
    });
    expect(validatePattern(undefined)).toEqual({
      ok: false,
      error: "api.patternNotString",
    });
    expect(validatePattern({})).toEqual({
      ok: false,
      error: "api.patternNotString",
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
      error: "api.patternTooLong",
      vars: { max: MAX_PATTERN_LENGTH },
    });
  });

  it("counts length after trimming, not before", () => {
    // 200 'a's plus 5 surrounding spaces → trimmed length = 200 → ok
    const padded = "  " + "a".repeat(MAX_PATTERN_LENGTH) + "   ";
    expect(validatePattern(padded)).toMatchObject({ ok: true });
  });
});

describe("safeRedirectPath", () => {
  const APP = "https://fintrack.app";

  it("keeps a same-origin path with its query", () => {
    const target = "/share-invite?token=abc&lang=nl";
    expect(safeRedirectPath(target)).toBe(target);
  });

  // The point of the guard: whatever comes back must not leave the origin.
  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("refuses to leave the origin for %j", (input) => {
    const result = safeRedirectPath(input);
    expect(new URL(result, APP).origin).toBe(APP);
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectPath("//evil.com", "/login")).toBe("/login");
  });
});
