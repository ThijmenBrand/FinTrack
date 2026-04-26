import { describe, it, expect } from "vitest";
import { paydaysBetween, type PaySchedule } from "./pay-schedule";

// Use local-time constructors so tests are timezone-independent.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

const monthly = (overrides: Partial<PaySchedule> = {}): PaySchedule => ({
  frequency: "monthly",
  startDate: "2024-01-25",
  dayOfWeek: null,
  dayOfMonth: 25,
  monthOfYear: null,
  ...overrides,
});

const weekly = (overrides: Partial<PaySchedule> = {}): PaySchedule => ({
  frequency: "weekly",
  startDate: "2024-01-01",
  dayOfWeek: 1, // Monday
  dayOfMonth: null,
  monthOfYear: null,
  ...overrides,
});

const biweekly = (overrides: Partial<PaySchedule> = {}): PaySchedule => ({
  frequency: "biweekly",
  startDate: "2026-04-25",
  dayOfWeek: null,
  dayOfMonth: null,
  monthOfYear: null,
  ...overrides,
});

const yearly = (overrides: Partial<PaySchedule> = {}): PaySchedule => ({
  frequency: "yearly",
  startDate: "2024-02-29",
  dayOfWeek: null,
  dayOfMonth: 29,
  monthOfYear: 2,
  ...overrides,
});

describe("paydaysBetween — window edges", () => {
  it("returns [] when to <= from", () => {
    expect(paydaysBetween(monthly(), d(2026, 5, 1), d(2026, 5, 1))).toEqual([]);
    expect(paydaysBetween(monthly(), d(2026, 5, 2), d(2026, 5, 1))).toEqual([]);
  });

  it("excludes a payday landing exactly on `to` (half-open window)", () => {
    // Monthly, 25th. Window covers [Apr 1, May 25). The May 25 payday must be excluded.
    const result = paydaysBetween(monthly(), d(2026, 4, 1), d(2026, 5, 25));
    expect(result).toEqual(["2026-04-25"]);
  });

  it("includes a payday landing exactly on `from`", () => {
    // Monthly, 25th. Window [Apr 25, Jun 1) → April 25 is included.
    const result = paydaysBetween(monthly(), d(2026, 4, 25), d(2026, 6, 1));
    expect(result).toEqual(["2026-04-25", "2026-05-25"]);
  });
});

describe("paydaysBetween — weekly", () => {
  it("honours dayOfWeek and produces a weekly cadence", () => {
    // dayOfWeek = 1 (Monday). Window: Mon Apr 27 → Tue May 26.
    const result = paydaysBetween(weekly(), d(2026, 4, 27), d(2026, 5, 26));
    expect(result).toEqual([
      "2026-04-27",
      "2026-05-04",
      "2026-05-11",
      "2026-05-18",
      "2026-05-25",
    ]);
  });

  it("advances to the next target DOW when `from` is mid-week", () => {
    // dayOfWeek = 1 (Monday). `from` is Wed Apr 29 → first payday should be Mon May 4.
    const result = paydaysBetween(weekly(), d(2026, 4, 29), d(2026, 5, 12));
    expect(result).toEqual(["2026-05-04", "2026-05-11"]);
  });
});

describe("paydaysBetween — biweekly (the reviewer's case)", () => {
  it("biweekly starting yesterday: first payday is +13 days, then +14 day cadence", () => {
    // schedule.startDate = 2026-04-25, "today" = 2026-04-26 (one day after start).
    // diffDays = 1, remainder = 1, so cur jumps forward by 13 days → first payday = 2026-05-09.
    // Window [today, today + 30d) → [2026-04-26, 2026-05-26).
    const result = paydaysBetween(biweekly(), d(2026, 4, 26), d(2026, 5, 26));
    expect(result).toEqual(["2026-05-09", "2026-05-23"]);
  });

  it("aligns when `from` is before startDate (clamps to start)", () => {
    // start = May 1, from = April 1. cur should clamp to May 1, remainder = 0.
    const sched = biweekly({ startDate: "2026-05-01" });
    const result = paydaysBetween(sched, d(2026, 4, 1), d(2026, 6, 1));
    expect(result).toEqual(["2026-05-01", "2026-05-15", "2026-05-29"]);
  });

  it("returns startDate itself when `from === startDate`", () => {
    const sched = biweekly({ startDate: "2026-05-01" });
    const result = paydaysBetween(sched, d(2026, 5, 1), d(2026, 5, 16));
    expect(result).toEqual(["2026-05-01", "2026-05-15"]);
  });

  it("aligns to next biweekly boundary when from is 7 days after start", () => {
    // diffDays = 7 → remainder = 7 → cur jumps +7 → first payday = start + 14d.
    const sched = biweekly({ startDate: "2026-05-01" });
    const result = paydaysBetween(sched, d(2026, 5, 8), d(2026, 5, 30));
    expect(result).toEqual(["2026-05-15", "2026-05-29"]);
  });
});

describe("paydaysBetween — monthly", () => {
  it("clamps day-of-month to the last day of short months", () => {
    // dayOfMonth = 31. Feb has 28 days (2026), April has 30, March has 31.
    const sched = monthly({ dayOfMonth: 31, startDate: "2024-01-31" });
    const result = paydaysBetween(sched, d(2026, 2, 1), d(2026, 5, 1));
    expect(result).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("clamps Feb 29 to Feb 28 in non-leap years and Feb 29 in leap years", () => {
    const sched = monthly({ dayOfMonth: 29, startDate: "2024-01-29" });
    expect(paydaysBetween(sched, d(2026, 2, 1), d(2026, 3, 1))).toEqual([
      "2026-02-28",
    ]);
    expect(paydaysBetween(sched, d(2028, 2, 1), d(2028, 3, 1))).toEqual([
      "2028-02-29",
    ]);
  });

  it("skips current month when from.getDate() > dom", () => {
    // dom = 15, from = April 20. Should skip April, start from May 15.
    const sched = monthly({ dayOfMonth: 15 });
    const result = paydaysBetween(sched, d(2026, 4, 20), d(2026, 7, 1));
    expect(result).toEqual(["2026-05-15", "2026-06-15"]);
  });

  it("rolls across the year boundary", () => {
    const sched = monthly({ dayOfMonth: 25 });
    const result = paydaysBetween(sched, d(2026, 12, 1), d(2027, 2, 1));
    expect(result).toEqual(["2026-12-25", "2027-01-25"]);
  });
});

describe("paydaysBetween — yearly", () => {
  it("clamps Feb 29 to Feb 28 on non-leap years", () => {
    const result = paydaysBetween(yearly(), d(2025, 1, 1), d(2029, 1, 1));
    // 2025 non-leap → Feb 28; 2026 non-leap → Feb 28; 2027 non-leap → Feb 28; 2028 leap → Feb 29.
    expect(result).toEqual([
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });
});
