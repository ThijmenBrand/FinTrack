import { describe, it, expect } from "vitest";
import { toMonthly, combineMonthSpend, mergeCategorySpend } from "./month-money";

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

describe("combineMonthSpend", () => {
  it("adds the magnitude of a net-negative pot to the ungrouped tx total", () => {
    // Pot net out is -30 (more out than in), so |min(0, -30)| = 30.
    expect(combineMonthSpend(100, -30)).toBe(130);
  });

  it("ignores a net-positive pot — funding is not spending", () => {
    // Pot received +70 net (deposit > expense). min(0, 70) = 0 → contributes 0.
    expect(combineMonthSpend(100, 70)).toBe(100);
  });

  it("treats a zero pot net as zero spend", () => {
    expect(combineMonthSpend(100, 0)).toBe(100);
  });

  it("documents the mixed-flow under-counting case", () => {
    // A pot got +€100 and spent €30 in the same month → potNet = +70.
    // The €30 outflow is masked by the deposit; combineMonthSpend returns 100.
    // This is the chosen design: pots are treated as a net flow, not a tally
    // of individual outflows. Locking in a regression test so future changes
    // are deliberate.
    expect(combineMonthSpend(100, 70)).toBe(100);
  });

  it("treats a fully-negative pot as adding the full magnitude", () => {
    // Pure spend of €40 from a pot, no deposits → potNet = -40.
    expect(combineMonthSpend(0, -40)).toBe(40);
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
