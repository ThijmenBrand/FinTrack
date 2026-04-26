import { describe, it, expect } from "vitest";
import { generateOccurrences } from "./recurring";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("generateOccurrences — weekly", () => {
  it("emits dates on the target day-of-week, inclusive of effectiveEnd", () => {
    const result = generateOccurrences(
      "weekly",
      "2026-04-27", // Mon
      null,
      1,
      null,
      null,
      d(2026, 4, 27),
      d(2026, 5, 25)
    );
    expect(result).toEqual([
      "2026-04-27",
      "2026-05-04",
      "2026-05-11",
      "2026-05-18",
      "2026-05-25",
    ]);
  });
});

describe("generateOccurrences — biweekly", () => {
  it("aligns to the schedule's mod-14 cadence", () => {
    const result = generateOccurrences(
      "biweekly",
      "2026-05-01",
      null,
      null,
      null,
      null,
      d(2026, 5, 1),
      d(2026, 6, 1)
    );
    expect(result).toEqual(["2026-05-01", "2026-05-15", "2026-05-29"]);
  });
});

describe("generateOccurrences — monthly", () => {
  it("clamps day-of-month to the last day of short months", () => {
    const result = generateOccurrences(
      "monthly",
      "2024-01-31",
      null,
      null,
      31,
      null,
      d(2026, 2, 1),
      d(2026, 5, 1)
    );
    expect(result).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("respects endDate when it cuts the window short", () => {
    const result = generateOccurrences(
      "monthly",
      "2026-01-15",
      "2026-03-20",
      null,
      15,
      null,
      d(2026, 1, 1),
      d(2026, 12, 31)
    );
    expect(result).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("returns [] when endDate is before forecastFrom", () => {
    const result = generateOccurrences(
      "monthly",
      "2025-01-15",
      "2025-12-31",
      null,
      15,
      null,
      d(2026, 1, 1),
      d(2026, 12, 31)
    );
    expect(result).toEqual([]);
  });
});

describe("generateOccurrences — yearly", () => {
  it("clamps Feb 29 to Feb 28 in non-leap years", () => {
    const result = generateOccurrences(
      "yearly",
      "2024-02-29",
      null,
      null,
      29,
      2,
      d(2025, 1, 1),
      d(2027, 12, 31)
    );
    expect(result).toEqual(["2025-02-28", "2026-02-28", "2027-02-28"]);
  });
});
