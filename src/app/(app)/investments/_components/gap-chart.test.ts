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
import { sliceToRange, smoothPath } from "./gap-chart";
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

/**
 * The curve between the dots.
 *
 * The property that matters is monotonicity: a cubic through financial figures
 * must not bulge past them, or the chart shows a portfolio value that was
 * never recorded. These sample each segment densely and check it stays inside
 * the two figures that bound it.
 */
function sample(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const nums = (seg: string) => seg.match(/-?\d+(\.\d+)?/g)!.map(Number);
  let cur = { x: 0, y: 0 };
  for (const seg of d.split(/(?=[MLC])/).map((t) => t.trim()).filter(Boolean)) {
    const n = nums(seg);
    if (seg[0] === "M" || seg[0] === "L") {
      cur = { x: n[0], y: n[1] };
      out.push(cur);
      continue;
    }
    const [c1x, c1y, c2x, c2y, ex, ey] = n;
    const p0 = cur;
    for (let i = 1; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      out.push({
        x: u ** 3 * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex,
        y: u ** 3 * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey,
      });
    }
    cur = { x: ex, y: ey };
  }
  return out;
}

describe("smoothPath", () => {
  it("has nothing to draw without points", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 10, y: 20 }])).toBe("M 10 20");
  });

  it("starts at the first point and ends at the last", () => {
    const d = smoothPath([
      { x: 0, y: 100 },
      { x: 50, y: 40 },
      { x: 100, y: 60 },
    ]);
    expect(d.startsWith("M 0 100")).toBe(true);
    expect(d.trimEnd().endsWith("100 60")).toBe(true);
  });

  it("passes through every point it was given", () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 30, y: 100 },
      { x: 60, y: 20 },
      { x: 90, y: 55 },
    ];
    const curve = sample(smoothPath(pts));
    for (const p of pts) {
      const near = curve.find((c) => Math.abs(c.x - p.x) < 0.5 && Math.abs(c.y - p.y) < 0.5);
      expect(near, `missing ${p.x},${p.y}`).toBeDefined();
    }
  });

  it("never overshoots a spike", () => {
    // A flat run, a jump, then flat again: the classic case where a plain
    // spline dips below the floor before climbing and sails past the peak.
    const pts = [
      { x: 0, y: 200 },
      { x: 25, y: 200 },
      { x: 50, y: 50 },
      { x: 75, y: 50 },
      { x: 100, y: 50 },
    ];
    const curve = sample(smoothPath(pts));
    for (const c of curve) {
      expect(c.y).toBeGreaterThanOrEqual(50 - 0.01);
      expect(c.y).toBeLessThanOrEqual(200 + 0.01);
    }
  });

  it("keeps a rising series rising", () => {
    const pts = [
      { x: 0, y: 300 },
      { x: 20, y: 280 },
      { x: 40, y: 275 },
      { x: 60, y: 120 },
      { x: 80, y: 118 },
      { x: 100, y: 20 },
    ];
    const curve = sample(smoothPath(pts));
    for (let i = 1; i < curve.length; i++) {
      // y falls on screen as the value rises; it may never turn back up.
      expect(curve[i].y).toBeLessThanOrEqual(curve[i - 1].y + 0.01);
    }
  });

  it("falls back to a straight hop between two figures on one day", () => {
    const d = smoothPath([
      { x: 10, y: 50 },
      { x: 10, y: 80 },
    ]);
    expect(d).toBe("M 10 50 L 10 80");
  });
});
