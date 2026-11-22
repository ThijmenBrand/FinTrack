/**
 * Range slicing for the investments chart.
 *
 * The subtle part is the point just OUTSIDE the window. Both series are step
 * functions, so the figure in force when a window opens was usually written
 * before it. Dropping it would start the value line at whatever the first
 * event inside happened to be and open the contributions line at zero — the
 * band would then show a gain the size of the whole portfolio on every short
 * range.
 */
import { describe, it, expect } from "vitest";
import { sliceToRange } from "./gap-chart";
import type { SeriesPoint } from "@/lib/investment-series";

const p = (date: string, value: number | null, contributed: number): SeriesPoint => ({
  date,
  value,
  contributed,
});

// Ends on 2026-06-30, so a 30-day window opens on 2026-05-31.
const series: SeriesPoint[] = [
  p("2026-01-01", null, 0),
  p("2026-02-01", 1_000, 1_000),
  p("2026-04-01", 2_200, 2_000),
  p("2026-06-15", 3_400, 3_000),
  p("2026-06-30", 3_400, 3_000),
];

describe("sliceToRange", () => {
  it("returns everything for the All range", () => {
    expect(sliceToRange(series, null)).toEqual(series);
  });

  it("opens the window on its own first day, carrying the figures in force", () => {
    // 30 days back from 2026-06-30 is 2026-05-31. The last figure before that
    // was written on 2026-04-01, so the window opens holding those numbers.
    const out = sliceToRange(series, 30);
    expect(out[0].date).toBe("2026-05-31");
    expect(out[0].value).toBe(2_200);
    expect(out[0].contributed).toBe(2_000);
    expect(out.map((pt) => pt.date)).toEqual([
      "2026-05-31",
      "2026-06-15",
      "2026-06-30",
    ]);
  });

  it("does not stretch a short window back to an old point", () => {
    const out = sliceToRange(series, 30);
    expect(out.every((pt) => pt.date >= "2026-05-31")).toBe(true);
  });

  it("keeps a null value null when the window opens before the first figure", () => {
    const early: SeriesPoint[] = [
      p("2026-01-01", null, 0),
      p("2026-01-10", null, 500),
      p("2026-06-30", 900, 800),
    ];
    const out = sliceToRange(early, 30);
    expect(out[0].value).toBeNull();
    expect(out[0].contributed).toBe(500);
  });

  it("uses a point that already sits on the boundary as-is", () => {
    const onEdge: SeriesPoint[] = [
      p("2026-01-01", 100, 100),
      p("2026-05-31", 500, 400),
      p("2026-06-30", 600, 400),
    ];
    const out = sliceToRange(onEdge, 30);
    expect(out.map((pt) => pt.date)).toEqual(["2026-05-31", "2026-06-30"]);
  });

  it("never opens a window at zero contributions", () => {
    for (const days of [30, 91, 182, 365]) {
      const out = sliceToRange(series, days);
      if (out.length === series.length) continue;
      expect(out[0].contributed).toBeGreaterThan(0);
    }
  });

  it("returns the whole series when the window covers it", () => {
    expect(sliceToRange(series, 3_650)).toEqual(series);
  });

  it("handles an empty series", () => {
    expect(sliceToRange([], 30)).toEqual([]);
  });

  it("keeps a single point as-is", () => {
    const one = [p("2026-06-30", 100, 50)];
    expect(sliceToRange(one, 30)).toEqual(one);
  });
});
