import { getI18nFor } from "@/lib/i18n/translate";
import { describe, expect, it } from "vitest";
import { daysLeftIn, elapsedDays, formatRangeLabel } from "./period";

const NOW = new Date("2026-08-05T12:00:00");

describe("elapsedDays", () => {
  it("counts inclusive days for a finished range", () => {
    expect(elapsedDays("2026-07-07", "2026-07-13", [], NOW)).toBe(7);
  });

  it("stops at today for a range still running", () => {
    // Jul 7 – Aug 6 with today Aug 5 = 30 days of spending so far, not 31.
    expect(elapsedDays("2026-07-07", "2026-08-06", [], NOW)).toBe(30);
  });

  it("falls back to the span of the data when unbounded", () => {
    const daily = [{ date: "2026-07-01" }, { date: "2026-07-10" }];
    expect(elapsedDays("", "", daily, NOW)).toBe(10);
  });

  it("returns 0 when the range hasn't started", () => {
    expect(elapsedDays("2026-09-01", "2026-09-30", [], NOW)).toBe(0);
  });
});

describe("daysLeftIn", () => {
  it("counts the rest of today plus every whole day after it", () => {
    expect(daysLeftIn("2026-08-06", NOW)).toBe(2);
  });

  it("is 0 once the range has ended", () => {
    expect(daysLeftIn("2026-07-06", NOW)).toBe(0);
  });
});

describe("formatRangeLabel", () => {
  it("labels an unbounded range", () => {
    expect(formatRangeLabel(getI18nFor("en"), "", "")).toBe("All time");
  });

  it("year lives on the end date only", () => {
    expect(formatRangeLabel(getI18nFor("en"), "2026-07-07", "2026-08-06")).toBe(
      "7 Jul – 6 Aug 2026",
    );
  });
});
