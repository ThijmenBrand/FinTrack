import { describe, it, expect } from "vitest";
import {
  closedMonthCount,
  currentFinancialSlot,
  financialSlotOf,
  financialYearOf,
  getFinancialYearMonths,
  getFinancialYearRange,
} from "./financial-year";

describe("financial year with startDay = 1", () => {
  it("is the plain calendar year", () => {
    expect(getFinancialYearRange(2026, 1)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(financialYearOf(new Date(2026, 0, 1), 1)).toBe(2026);
    expect(financialYearOf(new Date(2026, 11, 31), 1)).toBe(2026);
  });

  it("indexes months by calendar month", () => {
    const months = getFinancialYearMonths(2026, 1);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({
      monthIndex: 0,
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(months[1].from).toBe("2026-02-01");
    // A leap year is not one of ours, so February ends on the 28th.
    expect(months[1].to).toBe("2026-02-28");
    expect(months[11]).toEqual({
      monthIndex: 11,
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });
});

describe("financial year with startDay = 25", () => {
  it("runs from January's start day to the day before the next one", () => {
    expect(getFinancialYearRange(2026, 25)).toEqual({
      from: "2026-01-25",
      to: "2027-01-24",
    });
  });

  it("puts early January in the previous financial year", () => {
    // 10 Jan 2026 is still inside the month that opened 25 Dec 2025.
    expect(financialYearOf(new Date(2026, 0, 10), 25)).toBe(2025);
    expect(financialSlotOf("2026-01-10", 25)).toEqual({
      year: 2025,
      monthIndex: 11,
    });
    // The 25th flips it over.
    expect(financialSlotOf("2026-01-25", 25)).toEqual({
      year: 2026,
      monthIndex: 0,
    });
  });
});

describe("the twelve months tile the year exactly", () => {
  for (const startDay of [1, 5, 15, 25, 28]) {
    it(`leaves no gap or overlap with startDay = ${startDay}`, () => {
      const months = getFinancialYearMonths(2026, startDay);
      for (let i = 1; i < months.length; i++) {
        const prevEnd = new Date(`${months[i - 1].to}T00:00:00`);
        const thisStart = new Date(`${months[i].from}T00:00:00`);
        const gapDays =
          (thisStart.getTime() - prevEnd.getTime()) / 86_400_000;
        expect(gapDays).toBe(1);
      }
      // …and every day of the year lands in exactly one of them.
      const { from, to } = getFinancialYearRange(2026, startDay);
      for (const iso of [from, to, "2026-06-15", "2026-03-01"]) {
        if (iso < from || iso > to) continue;
        const hits = months.filter((m) => iso >= m.from && iso <= m.to);
        expect(hits).toHaveLength(1);
      }
    });
  }

  it("chains one year's end into the next year's start", () => {
    const y2026 = getFinancialYearRange(2026, 25);
    const y2027 = getFinancialYearRange(2027, 25);
    expect(y2026.to).toBe("2027-01-24");
    expect(y2027.from).toBe("2027-01-25");
  });
});

describe("closedMonthCount", () => {
  it("counts only months that have fully finished", () => {
    // 15 Mar 2026: January and February are done, March is still running.
    expect(closedMonthCount(2026, 1, new Date(2026, 2, 15))).toBe(2);
    // The last day of a month does not close it — you can still spend.
    expect(closedMonthCount(2026, 1, new Date(2026, 0, 31))).toBe(0);
    expect(closedMonthCount(2026, 1, new Date(2026, 1, 1))).toBe(1);
  });

  it("is 0 before the year starts and 12 once it is over", () => {
    expect(closedMonthCount(2026, 1, new Date(2025, 11, 31))).toBe(0);
    expect(closedMonthCount(2026, 1, new Date(2027, 0, 1))).toBe(12);
  });

  it("follows the start day, not the calendar", () => {
    // With startDay 25, the month that began 25 Jan 2026 only closes on 25 Feb.
    expect(closedMonthCount(2026, 25, new Date(2026, 1, 24))).toBe(0);
    expect(closedMonthCount(2026, 25, new Date(2026, 1, 25))).toBe(1);
  });
});

describe("currentFinancialSlot", () => {
  it("reports the month being spent from right now", () => {
    expect(currentFinancialSlot(1, new Date(2026, 6, 4))).toEqual({
      year: 2026,
      monthIndex: 6,
    });
    expect(currentFinancialSlot(25, new Date(2026, 6, 4))).toEqual({
      year: 2026,
      monthIndex: 5,
    });
  });
});
