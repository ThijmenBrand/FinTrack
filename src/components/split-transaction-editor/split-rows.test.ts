import { describe, it, expect } from "vitest";
import { buildRuleLines, rebalanceRows, newSplitRow } from "./split-rows";

const rows = (...amounts: string[]) => amounts.map((a) => newSplitRow(a));

describe("rebalanceRows", () => {
  it("scales the other part down when one grows", () => {
    const [a, b] = rows("0.00", "38.99");
    const out = rebalanceRows([a, b], a.key, "10", 3899);
    expect(out.map((r) => r.amount)).toEqual(["10", "28.99"]);
  });

  it("scales the other part up when one shrinks", () => {
    const [a, b] = rows("10.00", "28.99");
    const out = rebalanceRows([a, b], a.key, "5", 3899);
    expect(out[1].amount).toBe("33.99");
  });

  it("absorbs into the last row when editing a middle one", () => {
    const [a, b, c] = rows("10.00", "10.00", "18.99");
    const out = rebalanceRows([a, b, c], b.key, "20", 3899);
    expect(out.map((r) => r.amount)).toEqual(["10.00", "20", "8.99"]);
  });

  it("absorbs into the previous row when editing the last one", () => {
    const [a, b, c] = rows("10.00", "10.00", "18.99");
    const out = rebalanceRows([a, b, c], c.key, "20", 3899);
    expect(out.map((r) => r.amount)).toEqual(["10.00", "8.99", "20"]);
  });

  it("clamps at zero instead of going negative", () => {
    const [a, b] = rows("10.00", "28.99");
    const out = rebalanceRows([a, b], a.key, "50", 3899);
    expect(out[1].amount).toBe("0.00");
  });
});

describe("buildRuleLines", () => {
  const withCategory = (amount: string, categoryId: string) => ({
    ...newSplitRow(amount),
    categoryId,
  });

  it("turns a 30/70 split into percentages that total exactly 100", () => {
    const lines = buildRuleLines(
      [withCategory("30.00", "a"), withCategory("70.00", "b")],
      "percentage",
      10000,
    );
    expect(lines.map((l) => l.percentage)).toEqual([30, 70]);
    expect(lines.reduce((s, l) => s + l.percentage!, 0)).toBe(100);
  });

  it("puts the rounding leftover on the last line", () => {
    const lines = buildRuleLines(
      [withCategory("3.34", "a"), withCategory("3.34", "b"), withCategory("3.33", "c")],
      "percentage",
      1001,
    );
    expect(lines.reduce((s, l) => s + l.percentage!, 0)).toBe(100);
  });

  // A couple of cents out of a five-figure amount rounds to 0.00%, which the
  // server rejects outright — the whole rule then failed with a generic
  // "invalid lines" the user had no way to read.
  it("never emits a 0% line for a part too small to round", () => {
    const lines = buildRuleLines(
      [withCategory("0.02", "a"), withCategory("50000.00", "b")],
      "percentage",
      5000002,
    );
    expect(lines.every((l) => l.percentage! > 0)).toBe(true);
    expect(lines.reduce((s, l) => s + l.percentage!, 0)).toBe(100);
  });

  it("makes the last line the remainder in fixed mode", () => {
    const lines = buildRuleLines(
      [withCategory("300.00", "a"), withCategory("700.00", "b")],
      "fixed",
      100000,
    );
    expect(lines).toEqual([
      { categoryId: "a", sortOrder: 0, isRemainder: false, amount: 300 },
      { categoryId: "b", sortOrder: 1, isRemainder: true, amount: undefined },
    ]);
  });
});
