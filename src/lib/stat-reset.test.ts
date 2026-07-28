import { describe, expect, it } from "vitest";
import {
  clampFrom,
  isBeforeCutoff,
  placeResetMarks,
} from "./stat-reset-marks";

describe("clampFrom", () => {
  it("passes the range start through when there is no cutoff", () => {
    expect(clampFrom("2026-01-01", null)).toBe("2026-01-01");
    expect(clampFrom(null, null)).toBe(null);
  });

  it("bounds an otherwise unbounded query at the cutoff", () => {
    expect(clampFrom(null, "2026-03-12")).toBe("2026-03-12");
    expect(clampFrom("", "2026-03-12")).toBe("2026-03-12");
  });

  it("takes the later of the two bounds", () => {
    expect(clampFrom("2026-01-01", "2026-03-12")).toBe("2026-03-12");
    expect(clampFrom("2026-06-01", "2026-03-12")).toBe("2026-06-01");
    expect(clampFrom("2026-03-12", "2026-03-12")).toBe("2026-03-12");
  });
});

describe("isBeforeCutoff", () => {
  it("is false without a cutoff", () => {
    expect(isBeforeCutoff("2020-01-01", null)).toBe(false);
  });

  it("flags dates in the previous era", () => {
    expect(isBeforeCutoff("2026-03-11", "2026-03-12")).toBe(true);
  });

  it("treats the cutoff day itself as in-era", () => {
    expect(isBeforeCutoff("2026-03-12", "2026-03-12")).toBe(false);
    expect(isBeforeCutoff("2026-04-01", "2026-03-12")).toBe(false);
  });
});

describe("placeResetMarks", () => {
  const daily = ["2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"].map(
    (d) => ({ start: d, end: d }),
  );
  const monthly = [
    { start: "2026-01-01", end: "2026-01-31" },
    { start: "2026-02-01", end: "2026-02-28" },
    { start: "2026-03-01", end: "2026-03-31" },
  ];

  it("returns nothing without buckets or resets", () => {
    expect(placeResetMarks([], [{ date: "2026-03-12", note: null }], null))
      .toEqual([]);
    expect(placeResetMarks(daily, [], null)).toEqual([]);
  });

  it("marks the first bucket of the new era for daily buckets", () => {
    const marks = placeResetMarks(
      daily,
      [{ date: "2026-03-12", note: "new job" }],
      "2026-03-12",
    );
    expect(marks).toEqual([
      { index: 2, date: "2026-03-12", note: "new job", isActive: true },
    ]);
  });

  it("marks the straddling bucket when a period contains the reset", () => {
    const marks = placeResetMarks(
      monthly,
      [{ date: "2026-02-14", note: null }],
      "2026-02-14",
    );
    expect(marks.map((m) => m.index)).toEqual([1]);
  });

  it("drops resets outside the plotted range", () => {
    expect(placeResetMarks(daily, [{ date: "2025-01-01", note: null }], null))
      .toEqual([]);
    expect(placeResetMarks(daily, [{ date: "2027-01-01", note: null }], null))
      .toEqual([]);
    // A reset on the very first day has no bucket to its left to divide.
    expect(placeResetMarks(daily, [{ date: "2026-03-10", note: null }], null))
      .toEqual([]);
  });

  it("keeps every reset in range, ordered, and flags only the active one", () => {
    const marks = placeResetMarks(
      monthly,
      [
        { date: "2026-03-01", note: "now" },
        { date: "2026-02-01", note: "then" },
      ],
      "2026-03-01",
    );
    expect(marks.map((m) => [m.index, m.isActive])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("collapses two resets that land in the same bucket", () => {
    const marks = placeResetMarks(
      monthly,
      [
        { date: "2026-02-20", note: "b" },
        { date: "2026-02-05", note: "a" },
      ],
      "2026-02-20",
    );
    expect(marks).toHaveLength(1);
  });
});
