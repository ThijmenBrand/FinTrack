import { describe, it, expect } from "vitest";
import {
  generateOccurrences,
  getNextOccurrence,
  isOccurrencePaid,
  toMonthly,
  fromMonthly,
} from "./recurring";

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

describe("getNextOccurrence", () => {
  // Regression: these used `new Date(y, m, d).toISOString()`, which shifts the
  // local midnight back a day for any timezone ahead of UTC — so a plan due on
  // the 25th reported the 24th, and the row disagreed with the forecast list.
  it("returns the configured day-of-month, not the UTC-shifted day before", () => {
    expect(getNextOccurrence("monthly", "2024-06-25", null, 25, null, d(2026, 8, 5))).toBe(
      "2026-08-25"
    );
  });

  it("rolls to next month once the day has passed", () => {
    expect(getNextOccurrence("monthly", "2024-06-01", null, 1, null, d(2026, 8, 5))).toBe(
      "2026-09-01"
    );
  });

  it("clamps a day-of-month past the end of the month", () => {
    expect(getNextOccurrence("monthly", "2024-01-31", null, 31, null, d(2026, 2, 1))).toBe(
      "2026-02-28"
    );
  });

  it("lands on the target weekday", () => {
    // 5 Aug 2026 is a Wednesday; the next Monday is the 10th.
    expect(getNextOccurrence("weekly", "2025-02-03", 1, null, null, d(2026, 8, 5))).toBe(
      "2026-08-10"
    );
  });

  it("never reports a date before a future start date", () => {
    // Plan starts 1 Feb 2027; on 28 Aug 2026 the next due date is the start,
    // not the coming 1 September.
    expect(getNextOccurrence("monthly", "2027-02-01", null, 1, null, d(2026, 8, 28))).toBe(
      "2027-02-01"
    );
    expect(getNextOccurrence("weekly", "2027-02-01", 1, null, null, d(2026, 8, 28))).toBe(
      "2027-02-01"
    );
    expect(getNextOccurrence("biweekly", "2027-02-01", null, null, null, d(2026, 8, 28))).toBe(
      "2027-02-01"
    );
    expect(getNextOccurrence("yearly", "2027-02-01", null, 1, 2, d(2026, 8, 28))).toBe(
      "2027-02-01"
    );
  });

  it("keeps a yearly plan on its own month and day", () => {
    expect(getNextOccurrence("yearly", "2024-10-14", null, 14, 10, d(2026, 8, 5))).toBe(
      "2026-10-14"
    );
  });
});

describe("fromMonthly", () => {
  const frequencies = ["weekly", "biweekly", "monthly", "yearly"] as const;
  const amounts = [899, 600, 12.5, 1000];

  for (const frequency of frequencies) {
    for (const amount of amounts) {
      it(`round-trips ${amount} through toMonthly/fromMonthly at ${frequency}`, () => {
        const monthly = toMonthly(amount, frequency);
        expect(fromMonthly(monthly, frequency)).toBeCloseTo(amount, 2);
      });
    }
  }

  it("is the concrete inverse of toMonthly for a €600/yr bill", () => {
    expect(toMonthly(600, "yearly")).toBe(50);
    expect(fromMonthly(50, "yearly")).toBe(600);
  });
});

describe("isOccurrencePaid", () => {
  it("settles the occurrence the payment landed nearest to", () => {
    // Bill due the 29th, direct debit taken a day early on 28 Aug.
    expect(isOccurrencePaid("monthly", "2026-08-29", "2026-08-28")).toBe(true);
    // The next one is still open.
    expect(isOccurrencePaid("monthly", "2026-09-29", "2026-08-28")).toBe(false);
    // A late payment for July doesn't clear August.
    expect(isOccurrencePaid("monthly", "2026-08-29", "2026-08-02")).toBe(false);
    expect(isOccurrencePaid("weekly", "2026-08-29", "2026-08-27")).toBe(true);
    expect(isOccurrencePaid("weekly", "2026-08-29", "2026-08-24")).toBe(false);
    expect(isOccurrencePaid("monthly", "2026-08-29", null)).toBe(false);
  });
});
