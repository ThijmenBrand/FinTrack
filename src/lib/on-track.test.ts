import { describe, it, expect } from "vitest";
import { classifyOnTrack } from "./on-track";

describe("classifyOnTrack — degenerate inputs", () => {
  it("returns on_pace with expected=0 when totalPaydays is 0", () => {
    expect(
      classifyOnTrack({
        fundedAmount: 200,
        targetAmount: 1000,
        totalPaydays: 0,
        elapsedPaydays: 0,
      })
    ).toEqual({ expectedFundedByNow: 0, onTrack: "on_pace" });
  });

  it("returns on_pace with expected=0 when targetAmount is 0", () => {
    expect(
      classifyOnTrack({
        fundedAmount: 0,
        targetAmount: 0,
        totalPaydays: 5,
        elapsedPaydays: 2,
      })
    ).toEqual({ expectedFundedByNow: 0, onTrack: "on_pace" });
  });
});

describe("classifyOnTrack — just-created spike (elapsedPaydays = 0)", () => {
  it("expected=0 and small positive funding stays on_pace within one slice", () => {
    // slice = 1000/10 = 100. funded = 50 < 0 + 100 → on_pace.
    const result = classifyOnTrack({
      fundedAmount: 50,
      targetAmount: 1000,
      totalPaydays: 10,
      elapsedPaydays: 0,
    });
    expect(result.expectedFundedByNow).toBe(0);
    expect(result.onTrack).toBe("on_pace");
  });

  it("classifies as ahead once funded > one slice", () => {
    const result = classifyOnTrack({
      fundedAmount: 150,
      targetAmount: 1000,
      totalPaydays: 10,
      elapsedPaydays: 0,
    });
    expect(result.onTrack).toBe("ahead");
  });
});

describe("classifyOnTrack — boundaries (exactly one slice ahead/behind)", () => {
  // target=1000, totalPaydays=10 → slice=100. elapsedPaydays=5 → expected=500.
  const base = { targetAmount: 1000, totalPaydays: 10, elapsedPaydays: 5 };

  it("funded === expected − slice classifies as on_pace (strict inequality)", () => {
    expect(classifyOnTrack({ ...base, fundedAmount: 400 }).onTrack).toBe(
      "on_pace"
    );
  });

  it("funded just below expected − slice classifies as behind", () => {
    expect(classifyOnTrack({ ...base, fundedAmount: 399.99 }).onTrack).toBe(
      "behind"
    );
  });

  it("funded === expected + slice classifies as on_pace", () => {
    expect(classifyOnTrack({ ...base, fundedAmount: 600 }).onTrack).toBe(
      "on_pace"
    );
  });

  it("funded just above expected + slice classifies as ahead", () => {
    expect(classifyOnTrack({ ...base, fundedAmount: 600.01 }).onTrack).toBe(
      "ahead"
    );
  });

  it("funded === expected classifies as on_pace", () => {
    expect(classifyOnTrack({ ...base, fundedAmount: 500 }).onTrack).toBe(
      "on_pace"
    );
  });
});

describe("classifyOnTrack — expected is capped at targetAmount", () => {
  it("clamps expected when elapsedPaydays > totalPaydays", () => {
    const result = classifyOnTrack({
      fundedAmount: 1000,
      targetAmount: 1000,
      totalPaydays: 10,
      elapsedPaydays: 12,
    });
    expect(result.expectedFundedByNow).toBe(1000);
    expect(result.onTrack).toBe("on_pace");
  });

  it("classifies under-funding as behind even after clamp", () => {
    // expected clamped to 1000, slice = 100. funded=800 < 900 → behind.
    const result = classifyOnTrack({
      fundedAmount: 800,
      targetAmount: 1000,
      totalPaydays: 10,
      elapsedPaydays: 12,
    });
    expect(result.expectedFundedByNow).toBe(1000);
    expect(result.onTrack).toBe("behind");
  });
});

describe("classifyOnTrack — overfunded", () => {
  it("classifies funded > target as ahead", () => {
    const result = classifyOnTrack({
      fundedAmount: 1100,
      targetAmount: 1000,
      totalPaydays: 10,
      elapsedPaydays: 5,
    });
    expect(result.onTrack).toBe("ahead");
  });
});
