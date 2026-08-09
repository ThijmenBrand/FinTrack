import { describe, expect, it } from "vitest";
import { buildBeats } from "./simple-story";
import type { InsightsData } from "@/types/api";

function makeData(over: Partial<InsightsData> = {}): InsightsData {
  return {
    categoryBreakdown: [],
    dailyTotals: [],
    monthlyTotals: [],
    monthlyCategoryTotals: [],
    summary: { totalIncome: 2000, totalExpenses: 1000, net: 1000, txCount: 20 },
    previous: null,
    statsCutoff: null,
    previousPredatesReset: false,
    topMerchants: [],
    ...over,
  };
}

const category = (id: string, name: string, total: number) => ({
  categoryId: id,
  categoryName: name,
  categoryColor: "#000",
  total,
  count: 1,
});

describe("buildBeats", () => {
  it("says nothing about a period it can't compare or break down", () => {
    expect(buildBeats(makeData(), 0, false)).toEqual([]);
  });

  it("calls a small change flat and a real one by its direction", () => {
    const flat = makeData({
      previous: { totalIncome: 0, totalExpenses: 990, net: 0, categoryTotals: {} },
    });
    expect(buildBeats(flat, 1000, true)[0].message).toBe(
      "insights.simple.beat.trendFlat",
    );

    const up = makeData({
      previous: { totalIncome: 0, totalExpenses: 400, net: 0, categoryTotals: {} },
    });
    expect(buildBeats(up, 1000, true)[0]).toMatchObject({
      message: "insights.simple.beat.trendUp",
      amount: 600,
    });

    const down = makeData({
      previous: { totalIncome: 0, totalExpenses: 1600, net: 0, categoryTotals: {} },
    });
    expect(buildBeats(down, 1000, true)[0]).toMatchObject({
      message: "insights.simple.beat.trendDown",
      amount: 600,
    });
  });

  it("drops the comparison beats when there is no previous period", () => {
    const data = makeData({
      previous: { totalIncome: 0, totalExpenses: 400, net: 0, categoryTotals: {} },
    });
    expect(buildBeats(data, 1000, false).map((b) => b.key)).not.toContain("trend");
  });

  it("names the biggest category only when there is something to be biggest than", () => {
    const one = makeData({ categoryBreakdown: [category("a", "Rent", 1000)] });
    expect(buildBeats(one, 1000, false)).toEqual([]);

    const two = makeData({
      categoryBreakdown: [category("a", "Rent", 700), category("b", "Food", 300)],
    });
    expect(buildBeats(two, 1000, false)[0]).toMatchObject({
      key: "biggest",
      name: "Rent",
      amount: 700,
      pct: 70,
      categoryId: "a",
    });
  });

  it("reports the biggest riser, skipping the category already called biggest", () => {
    const data = makeData({
      categoryBreakdown: [
        category("a", "Rent", 700),
        category("b", "Food", 300),
        category("c", "Transport", 100),
      ],
      previous: {
        totalIncome: 0,
        totalExpenses: 1000,
        net: 0,
        // Rent rose most, but it's already the "biggest" beat.
        categoryTotals: { a: 200, b: 100, c: 90 },
      },
    });
    expect(buildBeats(data, 1100, true).find((b) => b.key === "swing")).toMatchObject({
      message: "insights.simple.beat.swing",
      name: "Food",
      amount: 200,
    });
  });

  it("falls back to the biggest drop when nothing rose enough", () => {
    const data = makeData({
      categoryBreakdown: [category("a", "Rent", 700), category("b", "Food", 50)],
      previous: {
        totalIncome: 0,
        totalExpenses: 1000,
        net: 0,
        categoryTotals: { a: 0, b: 300 },
      },
    });
    expect(buildBeats(data, 750, true).find((b) => b.key === "swing")).toMatchObject({
      message: "insights.simple.beat.swingDown",
      name: "Food",
      amount: 250,
    });
  });

  it("names a merchant only once it's a real share of spending", () => {
    const small = makeData({
      topMerchants: [{ description: "ALBERT HEIJN 1234", total: 50, count: 3 }],
    });
    expect(buildBeats(small, 1000, false)).toEqual([]);

    const big = makeData({
      topMerchants: [{ description: "ALBERT HEIJN 1234", total: 300, count: 3 }],
    });
    expect(buildBeats(big, 1000, false)[0]).toMatchObject({
      message: "insights.simple.beat.merchantRepeat",
      amount: 300,
      count: 3,
    });

    const once = makeData({
      topMerchants: [{ description: "MEDIAMARKT", total: 300, count: 1 }],
    });
    expect(buildBeats(once, 1000, false)[0].message).toBe(
      "insights.simple.beat.merchantOnce",
    );
  });
});
