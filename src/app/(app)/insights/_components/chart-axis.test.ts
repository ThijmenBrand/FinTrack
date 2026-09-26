import { describe, it, expect } from "vitest";
import { formatTick, niceMax } from "./chart-axis";

describe("formatTick", () => {
  it("labels zero as €0", () => {
    expect(formatTick(0)).toBe("€0");
  });

  it("rounds amounts under a thousand to whole euros", () => {
    expect(formatTick(350)).toBe("€350");
    expect(formatTick(12.4)).toBe("€12");
    expect(formatTick(999.4)).toBe("€999");
  });

  it("switches to k at a thousand, dropping a whole number's decimal", () => {
    expect(formatTick(1000)).toBe("€1k");
    expect(formatTick(2000)).toBe("€2k");
    expect(formatTick(2500)).toBe("€2.5k");
    expect(formatTick(1250)).toBe("€1.3k");
  });

  it("keeps the sign on negative ticks, using k by magnitude", () => {
    expect(formatTick(-250)).toBe("€-250");
    expect(formatTick(-1500)).toBe("€-1.5k");
    expect(formatTick(-3000)).toBe("€-3k");
  });
});

describe("niceMax", () => {
  it("falls back to 100 for an empty or negative series", () => {
    expect(niceMax(0)).toBe(100);
    expect(niceMax(-50)).toBe(100);
  });

  it("rounds up to 1, 2, 2.5, 5 or 10 times a power of ten", () => {
    expect(niceMax(80)).toBe(100);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(210)).toBe(250);
    expect(niceMax(260)).toBe(500);
    expect(niceMax(510)).toBe(1000);
    expect(niceMax(0.3)).toBe(0.5);
  });

  it("leaves a value that is already nice where it is", () => {
    for (const v of [1, 2, 2.5, 5, 10, 200, 2500, 50_000]) expect(niceMax(v)).toBe(v);
  });

  it("never returns less than its input", () => {
    for (const v of [3, 7, 11, 99, 101, 333, 4321, 98_765]) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
  });
});
