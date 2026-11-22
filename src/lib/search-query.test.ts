import { describe, it, expect } from "vitest";
import { parseDayInput, parseSearchTerm } from "./search-query";

describe("parseSearchTerm", () => {
  it("treats plain words as text only", () => {
    expect(parseSearchTerm("albert heijn")).toEqual({ text: "albert heijn" });
  });

  it("matches an exact amount, sign-insensitive, alongside text", () => {
    const r = parseSearchTerm("12.50");
    expect(r.text).toBe("12.50");
    expect(r.amount!.min).toBeCloseTo(12.495);
    expect(r.amount!.max).toBeCloseTo(12.505);
    expect(parseSearchTerm("-12,50").amount).toEqual(r.amount);
    expect(parseSearchTerm("€12.50").amount).toEqual(r.amount);
  });

  it("widens ~amount to a range and drops text matching", () => {
    const r = parseSearchTerm("~100");
    expect(r.text).toBeNull();
    expect(r.amount).toEqual({ min: 90, max: 110 });
  });

  it("falls back to text when ~ is not followed by a number", () => {
    expect(parseSearchTerm("~ah")).toEqual({ text: "~ah" });
  });

  it("accepts ISO and day-first dates", () => {
    expect(parseSearchTerm("2026-07-28").date).toBe("2026-07-28");
    expect(parseSearchTerm("28-07-2026").date).toBe("2026-07-28");
    expect(parseSearchTerm("1/7/2026").date).toBe("2026-07-01");
  });

  it("does not read a thousands-separated amount as a date", () => {
    expect(parseSearchTerm("1.250").amount!.min).toBeCloseTo(1249.995);
  });
});

describe("parseDayInput", () => {
  it("normalises ISO and day-first dates to one ISO day", () => {
    expect(parseDayInput("2026-08-22")).toBe("2026-08-22");
    expect(parseDayInput("22-08-2026")).toBe("2026-08-22");
    expect(parseDayInput("1/7/2026")).toBe("2026-07-01");
    expect(parseDayInput("1.7.2026")).toBe("2026-07-01");
    expect(parseDayInput(" 2026-8-2 ")).toBe("2026-08-02");
  });

  it("rejects days that never existed", () => {
    expect(parseDayInput("2026-13-01")).toBeNull();
    expect(parseDayInput("2026-02-30")).toBeNull();
    expect(parseDayInput("2024-02-29")).toBe("2024-02-29"); // leap year
    expect(parseDayInput("2026-00-10")).toBeNull();
  });

  it("rejects anything that is not a date", () => {
    expect(parseDayInput("albert heijn")).toBeNull();
    expect(parseDayInput("12.50")).toBeNull();
    expect(parseDayInput("2026-07")).toBeNull();
  });
});
