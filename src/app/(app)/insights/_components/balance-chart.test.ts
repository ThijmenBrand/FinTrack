import { describe, it, expect } from "vitest";
import { rangeViewStart } from "./balance-chart";

// 100 consecutive days ending 2026-04-10.
const dates = Array.from({ length: 100 }, (_, i) => {
  const d = new Date("2026-01-01T00:00:00");
  d.setDate(d.getDate() + i);
  return d.toISOString().slice(0, 10);
});

describe("rangeViewStart", () => {
  it("keeps the trailing window, inclusive of the cutoff day", () => {
    // 30 days back from the last point => index 69 of 99.
    expect(rangeViewStart(dates, 30)).toBeCloseTo(69 / 99);
  });

  it("falls back to the whole series when the window is longer than history", () => {
    expect(rangeViewStart(dates, 365)).toBe(0);
    expect(rangeViewStart(dates, null)).toBe(0);
    expect(rangeViewStart(["2026-01-01"], 30)).toBe(0);
    expect(rangeViewStart([], 30)).toBe(0);
  });
});
