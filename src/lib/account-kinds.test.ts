/**
 * The cash/valuation split.
 *
 * These tests exist to pin the one invariant the investments feature rests
 * on: a valuation never lands in a figure the rest of the app treats as money
 * you hold. Everything else about investments can change; if `sumCashBalances`
 * ever starts counting an investment account, the dashboard total, the budget
 * and the low-balance warning all begin drifting with the market at once.
 */
import { describe, it, expect } from "vitest";
import {
  VALUATION_STALE_DAYS,
  isCashAccount,
  isInvestmentAccount,
  isValuationStale,
  sumCashBalances,
  sumInvestmentValues,
  valuationAgeDays,
} from "@/lib/account-kinds";

const cash = (type: string, currentBalance: number) => ({
  type,
  currentBalance,
  currentValue: null,
});
const investment = (currentBalance: number, currentValue: number | null) => ({
  type: "investment",
  currentBalance,
  currentValue,
});

describe("account kinds", () => {
  it("treats every type but investment as cash", () => {
    for (const type of ["checking", "savings", "joint", "credit", "other"]) {
      expect(isCashAccount({ type })).toBe(true);
      expect(isInvestmentAccount({ type })).toBe(false);
    }
    expect(isCashAccount({ type: "investment" })).toBe(false);
    expect(isInvestmentAccount({ type: "investment" })).toBe(true);
  });
});

describe("sumCashBalances", () => {
  it("leaves investment accounts out of the cash total", () => {
    const rows = [
      cash("checking", 1200),
      cash("savings", 3000),
      investment(32_480, 32_480),
    ];
    expect(sumCashBalances(rows)).toBe(4200);
  });

  it("counts a negative credit balance against the total", () => {
    expect(sumCashBalances([cash("checking", 500), cash("credit", -120)])).toBe(380);
  });

  it("is zero when the user holds investments only", () => {
    expect(sumCashBalances([investment(32_480, 32_480)])).toBe(0);
  });
});

describe("sumInvestmentValues", () => {
  it("adds up valuations and ignores cash", () => {
    const rows = [
      cash("checking", 1200),
      investment(20_000, 20_000),
      investment(12_480, 12_480),
    ];
    expect(sumInvestmentValues(rows)).toBe(32_480);
  });

  it("counts a never-valued account as nothing, not as a loss", () => {
    expect(sumInvestmentValues([investment(0, null), investment(500, 500)])).toBe(500);
  });
});

describe("valuationAgeDays", () => {
  const now = new Date("2026-11-22T13:45:00Z");

  it("counts whole days back from today", () => {
    expect(valuationAgeDays("2026-11-20", now)).toBe(2);
    expect(valuationAgeDays("2026-11-22", now)).toBe(0);
  });

  it("ignores the time of day on either side", () => {
    expect(valuationAgeDays("2026-11-21", new Date("2026-11-22T00:00:01Z"))).toBe(1);
    expect(valuationAgeDays("2026-11-21", new Date("2026-11-22T23:59:59Z"))).toBe(1);
  });

  it("clamps a future date to today rather than reporting a negative age", () => {
    expect(valuationAgeDays("2026-12-01", now)).toBe(0);
  });

  it("is null when there is no date, or the date is unreadable", () => {
    expect(valuationAgeDays(null, now)).toBeNull();
    expect(valuationAgeDays(undefined, now)).toBeNull();
    expect(valuationAgeDays("not-a-date", now)).toBeNull();
  });
});

describe("isValuationStale", () => {
  const now = new Date("2026-11-22T00:00:00Z");

  it("accepts a valuation inside the window", () => {
    expect(isValuationStale("2026-11-20", now)).toBe(false);
  });

  it("flags one past the window", () => {
    const old = new Date(now);
    old.setUTCDate(old.getUTCDate() - (VALUATION_STALE_DAYS + 1));
    expect(isValuationStale(old.toISOString().slice(0, 10), now)).toBe(true);
  });

  it("accepts one exactly on the boundary", () => {
    const edge = new Date(now);
    edge.setUTCDate(edge.getUTCDate() - VALUATION_STALE_DAYS);
    expect(isValuationStale(edge.toISOString().slice(0, 10), now)).toBe(false);
  });

  it("treats never valued as stale — it needs the same nudge", () => {
    expect(isValuationStale(null, now)).toBe(true);
  });
});
