import { describe, it, expect } from "vitest";
import { combineAnnualIncome, currentMonthIndexFor } from "./annual-income";

const banked = (entries: Record<number, number>) =>
  new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));

describe("combineAnnualIncome", () => {
  it("projects the whole year before it starts", () => {
    const result = combineAnnualIncome({
      actualByMonth: new Map(),
      monthlyRecurring: 3000,
      closedThrough: 0,
      currentMonthIndex: -1,
    });
    expect(result).toMatchObject({
      actual: 0,
      projected: 36_000,
      total: 36_000,
      monthsBanked: 0,
      monthsProjected: 12,
    });
  });

  it("uses only what really arrived for a year that is over", () => {
    const result = combineAnnualIncome({
      actualByMonth: banked({ 0: 3000, 4: 6000, 11: 3000 }),
      monthlyRecurring: 3000,
      closedThrough: 12,
      currentMonthIndex: 12,
    });
    expect(result.total).toBe(12_000);
    expect(result.projected).toBe(0);
    expect(result.monthsBanked).toBe(12);
  });

  it("counts holiday pay instead of flattening it to twelve equal months", () => {
    // May pays double. The ×12 shortcut would report 36,000 for the year;
    // the truth is 39,000.
    const actual = banked({
      0: 3000,
      1: 3000,
      2: 3000,
      3: 3000,
      4: 6000,
      5: 3000,
    });
    const result = combineAnnualIncome({
      actualByMonth: actual,
      monthlyRecurring: 3000,
      closedThrough: 6,
      currentMonthIndex: 6,
    });

    expect(result.actual).toBe(21_000);
    // July in progress plus five months to come, at plan.
    expect(result.projected).toBe(18_000);
    expect(result.total).toBe(39_000);
    expect(3000 * 12).toBe(36_000); // what the naive version would have said
  });

  it("reserves the salary early in the month, before it lands", () => {
    const result = combineAnnualIncome({
      actualByMonth: banked({ 6: 0 }),
      monthlyRecurring: 3000,
      closedThrough: 6,
      currentMonthIndex: 6,
    });
    // July contributes its planned 3,000 even though nothing has arrived yet.
    expect(result.projected).toBe(3000 * 6);
    expect(result.monthsProjected).toBe(6);
  });

  it("switches the current month to actual once it exceeds the plan", () => {
    const result = combineAnnualIncome({
      actualByMonth: banked({ 6: 6000 }),
      monthlyRecurring: 3000,
      closedThrough: 6,
      currentMonthIndex: 6,
    });
    // A bonus in the current month is counted, not capped at the plan.
    expect(result.actual).toBe(6000);
    expect(result.total).toBe(6000 + 3000 * 5);
  });

  it("never counts a month twice", () => {
    const result = combineAnnualIncome({
      actualByMonth: banked({ 0: 100, 1: 100, 2: 100 }),
      monthlyRecurring: 50,
      closedThrough: 3,
      currentMonthIndex: 3,
    });
    expect(result.monthsBanked + result.monthsProjected).toBe(12);
    expect(result.total).toBe(300 + 50 * 9);
  });

  it("handles a user with no recurring income at all", () => {
    const result = combineAnnualIncome({
      actualByMonth: banked({ 0: 1200 }),
      monthlyRecurring: 0,
      closedThrough: 1,
      currentMonthIndex: 1,
    });
    expect(result.total).toBe(1200);
    expect(result.projected).toBe(0);
  });

  it("ignores income recorded in months the year has not reached", () => {
    // A future-dated transaction should not inflate the projection path.
    const result = combineAnnualIncome({
      actualByMonth: banked({ 11: 9999 }),
      monthlyRecurring: 1000,
      closedThrough: 0,
      currentMonthIndex: 0,
    });
    expect(result.total).toBe(12_000);
  });
});

describe("currentMonthIndexFor", () => {
  it("points at the month in progress", () => {
    expect(currentMonthIndexFor(2026, 1, new Date(2026, 6, 15))).toBe(6);
  });

  it("is -1 before the year and 12 after it", () => {
    expect(currentMonthIndexFor(2026, 1, new Date(2025, 6, 15))).toBe(-1);
    expect(currentMonthIndexFor(2026, 1, new Date(2027, 6, 15))).toBe(12);
  });

  it("follows the financial start day at the year edge", () => {
    // 10 Jan 2027 still belongs to financial year 2026 when the month opens
    // on the 25th.
    expect(currentMonthIndexFor(2026, 25, new Date(2027, 0, 10))).toBe(11);
    expect(currentMonthIndexFor(2026, 25, new Date(2027, 0, 25))).toBe(12);
  });
});
