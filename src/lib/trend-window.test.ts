import { describe, it, expect } from "vitest";
import { trendWindow } from "./trend-window";

const TODAY = new Date(2026, 6, 15); // 15 Jul 2026

describe("trendWindow", () => {
  it("reaches back a year when the range is a single month", () => {
    expect(trendWindow("2026-07-01", "2026-07-31", 12, TODAY)).toEqual({
      from: "2025-08-01",
      to: "2026-07-31",
    });
  });

  it("keeps a range that is already wider", () => {
    expect(trendWindow("2020-01-01", "2026-12-31", 12, TODAY)).toEqual({
      from: "2020-01-01",
      to: "2026-12-31",
    });
  });

  it("leaves All Time unbounded", () => {
    expect(trendWindow(null, null, 12, TODAY)).toEqual({ from: null, to: null });
  });

  it("does not skip a month when today has no counterpart in the target month", () => {
    // 31 Mar minus 1 month is 3 Mar under naive Date math — must be 1 Feb.
    expect(trendWindow("2026-03-31", "2026-03-31", 2, new Date(2026, 2, 31)).from).toBe(
      "2026-02-01",
    );
  });
});
