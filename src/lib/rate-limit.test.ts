import { describe, it, expect, vi, afterEach } from "vitest";
import { createRateLimiter } from "./rate-limit";

afterEach(() => vi.useRealTimers());

describe("createRateLimiter", () => {
  it("allows up to max per window, then refuses", () => {
    const allow = createRateLimiter(1000, 3);
    expect([allow("a"), allow("a"), allow("a"), allow("a")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("counts each key separately", () => {
    const allow = createRateLimiter(1000, 1);
    expect(allow("a")).toBe(true);
    expect(allow("b")).toBe(true);
    expect(allow("a")).toBe(false);
  });

  it("starts a fresh window once the old one expires", () => {
    vi.useFakeTimers();
    const allow = createRateLimiter(1000, 1);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(allow("a")).toBe(true);
  });

  // The sweep is a memory concern a unit test can't weigh directly, so assert
  // the part that would be a real bug: it must not drop a still-live window.
  it("keeps unexpired keys when the eviction sweep runs", () => {
    vi.useFakeTimers();
    const allow = createRateLimiter(1000, 1);
    // Fill past the 10k threshold at t=0, so these expire at t=1000.
    for (let i = 0; i < 10_001; i++) allow(`k${i}`);

    vi.advanceTimersByTime(600);
    expect(allow("live")).toBe(true); // window runs to t=1600

    vi.advanceTimersByTime(500); // t=1100 — the cohort is expired, "live" is not
    allow("trigger"); // map is still oversized, so this fires the sweep

    expect(allow("live")).toBe(false); // survived the sweep, still counted
  });
});
