import { describe, it, expect } from "vitest";
import { toMonthly, mergeCategorySpend } from "./month-money";

describe("toMonthly", () => {
  it("converts known frequencies", () => {
    expect(toMonthly(100, "weekly")).toBeCloseTo(433);
    expect(toMonthly(100, "biweekly")).toBeCloseTo(217);
    expect(toMonthly(100, "monthly")).toBe(100);
    expect(toMonthly(1200, "yearly")).toBe(100);
  });

  it("takes the absolute value of the input amount", () => {
    expect(toMonthly(-100, "monthly")).toBe(100);
    expect(toMonthly(-100, "weekly")).toBeCloseTo(433);
  });

  it("falls back to abs(amount) for unknown frequencies", () => {
    expect(toMonthly(50, "daily")).toBe(50);
    expect(toMonthly(-50, "")).toBe(50);
  });

  it("handles zero", () => {
    expect(toMonthly(0, "monthly")).toBe(0);
    expect(toMonthly(0, "weekly")).toBe(0);
  });
});

describe("mergeCategorySpend — the in-month double-counting interaction", () => {
  it("sums per-category totals across ungrouped txs and pots", () => {
    const result = mergeCategorySpend(
      [{ categoryId: "A", total: 50 }],
      [{ categoryId: "A", total: 30 }]
    );
    expect(result.get("A")).toBe(80);
  });

  it("keeps categories that only appear in one input", () => {
    const result = mergeCategorySpend(
      [
        { categoryId: "A", total: 50 },
        { categoryId: "B", total: 25 },
      ],
      [{ categoryId: "C", total: 10 }]
    );
    expect(result.get("A")).toBe(50);
    expect(result.get("B")).toBe(25);
    expect(result.get("C")).toBe(10);
  });

  it("drops rows with a null categoryId in either input", () => {
    const result = mergeCategorySpend(
      [{ categoryId: null, total: 50 }],
      [{ categoryId: null, total: 30 }]
    );
    expect(result.size).toBe(0);
  });

  it("coerces null/undefined totals to 0", () => {
    const result = mergeCategorySpend(
      [{ categoryId: "A", total: null }],
      [{ categoryId: "A", total: 30 }]
    );
    expect(result.get("A")).toBe(30);
  });

  it("does NOT itself prevent double-counting — the SQL filter does", () => {
    // The function is a pure adder. Its contract is that the ungrouped query
    // (groupId IS NULL) and the pot query (groupId IS NOT NULL) feed disjoint
    // rows. If the same category amount were submitted twice, this helper
    // would happily sum them. Pin the behaviour so anyone changing the
    // upstream queries notices.
    const result = mergeCategorySpend(
      [{ categoryId: "A", total: 50 }],
      [{ categoryId: "A", total: 50 }]
    );
    expect(result.get("A")).toBe(100);
  });
});
