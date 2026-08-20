import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeDateRange } from "./transaction-search-bar";

// The period presets must line up with the budgets/insights windows, which run
// on the user's financial-month start day — not on the 1st of the calendar month.
describe("computeDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20)); // 20 Aug 2026, local
  });
  afterEach(() => vi.useRealTimers());

  it("uses calendar months when the financial month starts on the 1st", () => {
    expect(computeDateRange("this-month", 1)).toEqual({ from: "2026-08-01", to: "" });
    expect(computeDateRange("last-month", 1)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("shifts to the financial month when the start day is not the 1st", () => {
    expect(computeDateRange("this-month", 25)).toEqual({ from: "2026-07-25", to: "" });
    expect(computeDateRange("last-month", 25)).toEqual({
      from: "2026-06-25",
      to: "2026-07-24",
    });
  });

  it("anchors multi-month presets on a financial-month boundary", () => {
    expect(computeDateRange("last-3-months", 25)).toEqual({ from: "2026-05-25", to: "" });
  });
});
