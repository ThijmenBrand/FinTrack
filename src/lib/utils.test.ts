import { describe, it, expect } from "vitest";
import { cn, formatCurrency, toIsoDate } from "./utils";

// Intl output uses non-breaking / narrow spaces; normalize for stable asserts.
const norm = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    const hidden = false as boolean;
    expect(cn("a", hidden && "b", "p-2", "p-4")).toBe("a p-4");
  });
});

describe("formatCurrency", () => {
  it("formats EUR in nl-NL by default", () => {
    expect(norm(formatCurrency(1234.56))).toBe("€ 1.234,56");
  });

  it("formats zero and negative amounts", () => {
    expect(norm(formatCurrency(0))).toBe("€ 0,00");
    expect(norm(formatCurrency(-1234.56))).toContain("1.234,56");
    expect(formatCurrency(-1234.56)).toContain("-");
  });

  it("supports non-EUR currencies", () => {
    expect(norm(formatCurrency(10, "USD"))).toContain("10,00");
    expect(formatCurrency(10, "USD")).not.toContain("€");
  });

  it("supports fixed fraction digits (rounded axis labels)", () => {
    expect(norm(formatCurrency(1234.56, "EUR", 0))).toBe("€ 1.235");
  });
});

describe("toIsoDate", () => {
  it("formats a local date as YYYY-MM-DD with zero padding", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses local components, not UTC conversion", () => {
    // TZ=UTC in vitest.config.ts, so local === UTC here; this documents that
    // the function reads getFullYear/getMonth/getDate rather than toISOString.
    const d = new Date(2026, 5, 15, 23, 59, 59);
    expect(toIsoDate(d)).toBe("2026-06-15");
  });
});
