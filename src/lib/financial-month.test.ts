import { describe, it, expect } from "vitest";
import {
  getFinancialMonthRange,
  getPreviousFinancialMonth,
  formatFinancialMonthLabel,
} from "./financial-month";

describe("getFinancialMonthRange", () => {
  it("reduces to the calendar month when startDay is 1", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 15), 1)).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    });
  });

  it("starts this calendar month when the reference day >= startDay", () => {
    expect(getFinancialMonthRange(new Date(2026, 3, 30), 27)).toEqual({
      from: "2026-04-27",
      to: "2026-05-26",
    });
  });

  it("starts the previous calendar month when the reference day < startDay", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 10), 27)).toEqual({
      from: "2026-04-27",
      to: "2026-05-26",
    });
  });

  it("includes the boundary day itself in the new month", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 27), 27).from).toBe(
      "2026-05-27",
    );
    expect(getFinancialMonthRange(new Date(2026, 4, 26), 27).from).toBe(
      "2026-04-27",
    );
  });

  it("crosses the year boundary backwards", () => {
    expect(getFinancialMonthRange(new Date(2026, 0, 5), 15)).toEqual({
      from: "2025-12-15",
      to: "2026-01-14",
    });
  });

  it("crosses the year boundary forwards", () => {
    expect(getFinancialMonthRange(new Date(2025, 11, 20), 15)).toEqual({
      from: "2025-12-15",
      to: "2026-01-14",
    });
  });

  it("handles February in a non-leap year with startDay 1", () => {
    expect(getFinancialMonthRange(new Date(2026, 1, 10), 1)).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("handles February in a leap year with startDay 1", () => {
    expect(getFinancialMonthRange(new Date(2028, 1, 10), 1)).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("clamps startDay above 28 down to 28", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 28), 31)).toEqual(
      getFinancialMonthRange(new Date(2026, 4, 28), 28),
    );
  });

  it("clamps startDay below 1 up to 1", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 15), 0)).toEqual(
      getFinancialMonthRange(new Date(2026, 4, 15), 1),
    );
    expect(getFinancialMonthRange(new Date(2026, 4, 15), -3)).toEqual(
      getFinancialMonthRange(new Date(2026, 4, 15), 1),
    );
  });

  it("treats NaN startDay as 1", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 15), NaN)).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    });
  });

  it("rounds a fractional startDay", () => {
    expect(getFinancialMonthRange(new Date(2026, 4, 15), 9.6)).toEqual(
      getFinancialMonthRange(new Date(2026, 4, 15), 10),
    );
  });
});

describe("getPreviousFinancialMonth", () => {
  it("returns the previous calendar month for startDay 1", () => {
    expect(getPreviousFinancialMonth(new Date(2026, 4, 15), 1)).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
    });
  });

  it("returns the window immediately before the current one", () => {
    // Jan 20 with startDay 25 → current window started Dec 25;
    // previous window is Nov 25 – Dec 24.
    expect(getPreviousFinancialMonth(new Date(2026, 0, 20), 25)).toEqual({
      from: "2025-11-25",
      to: "2025-12-24",
    });
  });

  it("is contiguous with the current window (prev.to = day before current.from)", () => {
    const ref = new Date(2026, 6, 3);
    const current = getFinancialMonthRange(ref, 10);
    const prev = getPreviousFinancialMonth(ref, 10);
    const dayBefore = new Date(current.from);
    dayBefore.setDate(dayBefore.getDate() - 1);
    expect(prev.to).toBe(dayBefore.toISOString().slice(0, 10));
  });
});

describe("formatFinancialMonthLabel", () => {
  it("uses a calendar-month label when startDay is 1", () => {
    expect(formatFinancialMonthLabel(new Date(2026, 4, 15), 1)).toBe(
      "May 2026",
    );
  });

  it("uses an explicit range label for a shifted month", () => {
    expect(formatFinancialMonthLabel(new Date(2026, 4, 15), 27)).toBe(
      "Apr 27 – May 26",
    );
  });

  it("respects the locale argument", () => {
    expect(
      formatFinancialMonthLabel(new Date(2026, 4, 15), 1, "nl-NL"),
    ).toMatch(/mei 2026/);
  });
});
