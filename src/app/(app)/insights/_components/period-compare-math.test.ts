import { describe, expect, it } from "vitest";
import {
  buildCategoryRows,
  buildMetricRows,
  cumulativeByDay,
  percentChange,
  periodDays,
  type CompareSide,
} from "./period-compare-math";

const NOW = new Date("2026-11-22T12:00:00");

const side = (
  from: string,
  to: string,
  summary: Partial<CompareSide["summary"]>,
  elapsedDays: number,
): CompareSide => ({
  from,
  to,
  summary: {
    totalIncome: 0,
    totalExpenses: 0,
    net: 0,
    txCount: 0,
    ...summary,
  },
  elapsedDays,
});

describe("periodDays", () => {
  it("counts both bounds", () => {
    expect(periodDays("2026-11-01", "2026-11-30")).toBe(30);
    expect(periodDays("2026-11-01", "2026-11-01")).toBe(1);
  });

  it("is 0 for an unbounded or inverted range", () => {
    expect(periodDays("", "2026-11-30")).toBe(0);
    expect(periodDays("2026-11-30", "2026-11-01")).toBe(0);
  });
});

describe("percentChange", () => {
  it("measures against the comparison period", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });

  it("has no base to grow from when the other period is zero", () => {
    expect(percentChange(100, 0)).toBeNull();
  });

  it("gives no percentage when the two straddle zero", () => {
    // +690 → −2853 is a different kind of month, not "513% down".
    expect(percentChange(-2853, 690)).toBeNull();
    expect(percentChange(690, -2853)).toBeNull();
  });

  it("keeps the sign of the change when the base is negative", () => {
    // A net of −50 against −100 is an improvement of 50, i.e. +50%.
    expect(percentChange(-50, -100)).toBe(50);
  });
});

describe("buildMetricRows", () => {
  const a = side(
    "2026-11-01",
    "2026-11-30",
    { totalIncome: 2000, totalExpenses: 1500, net: 500, txCount: 20 },
    30,
  );
  const b = side(
    "2026-10-01",
    "2026-10-31",
    { totalIncome: 2000, totalExpenses: 1000, net: 1000, txCount: 15 },
    31,
  );

  it("reports deltas as A minus B", () => {
    const rows = buildMetricRows(a, b);
    const expenses = rows.find((r) => r.key === "expenses")!;
    expect(expenses.delta).toBe(500);
    expect(expenses.pct).toBe(50);
    expect(expenses.upIsGood).toBe(false);
  });

  it("colours income and net as up-is-good", () => {
    const rows = buildMetricRows(a, b);
    expect(rows.find((r) => r.key === "income")!.upIsGood).toBe(true);
    expect(rows.find((r) => r.key === "net")!.upIsGood).toBe(true);
  });

  it("derives the savings rate from each side's own income", () => {
    const rows = buildMetricRows(a, b);
    const rate = rows.find((r) => r.key === "savingsRate")!;
    expect(rate.a).toBeCloseTo(25);
    expect(rate.b).toBeCloseTo(50);
    expect(rate.delta).toBeCloseTo(-25);
  });

  it("withholds the savings rate when a period had no income", () => {
    const noIncome = side("2026-10-01", "2026-10-31", { totalExpenses: 400, net: -400 }, 31);
    const rate = buildMetricRows(a, noIncome).find((r) => r.key === "savingsRate")!;
    expect(rate.b).toBeNull();
    expect(rate.delta).toBeNull();
    expect(rate.pct).toBeNull();
  });

  it("leaves the transaction count uncoloured — fewer is neither good nor bad", () => {
    expect(buildMetricRows(a, b).find((r) => r.key === "txCount")!.upIsGood).toBeNull();
  });

  it("normalises spend per elapsed day, not per period", () => {
    const perDay = buildMetricRows(a, b).find((r) => r.key === "perDay")!;
    expect(perDay.a).toBeCloseTo(50); // 1500 / 30
    expect(perDay.b).toBeCloseTo(1000 / 31);
  });
});

describe("buildCategoryRows", () => {
  const cat = (id: string | null, name: string, total: number) => ({
    categoryId: id,
    categoryName: name,
    categoryColor: "#111111",
    total,
  });

  it("pairs categories and sorts by the size of the change", () => {
    const rows = buildCategoryRows(
      [cat("g", "Groceries", 300), cat("h", "Housing", 1000)],
      [cat("g", "Groceries", 100), cat("h", "Housing", 990)],
    );
    expect(rows.map((r) => r.categoryId)).toEqual(["g", "h"]);
    expect(rows[0].delta).toBe(200);
    expect(rows[1].delta).toBe(10);
  });

  it("flags categories only one period spent in", () => {
    const rows = buildCategoryRows([cat("new", "Holiday", 400)], [cat("gone", "Gym", 50)]);
    const holiday = rows.find((r) => r.categoryId === "new")!;
    const gym = rows.find((r) => r.categoryId === "gone")!;
    expect(holiday.status).toBe("onlyA");
    expect(holiday.b).toBe(0);
    expect(gym.status).toBe("onlyB");
    expect(gym.a).toBe(0);
    expect(gym.delta).toBe(-50);
  });

  it("keeps the current period's name when a category was renamed", () => {
    const rows = buildCategoryRows([cat("g", "Boodschappen", 100)], [cat("g", "Groceries", 80)]);
    expect(rows[0].name).toBe("Boodschappen");
  });

  it("folds uncategorized spend from both periods into one row", () => {
    const rows = buildCategoryRows([cat(null, "Uncategorized", 20)], [cat(null, "Uncategorized", 5)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ categoryId: null, a: 20, b: 5, delta: 15 });
  });
});

describe("cumulativeByDay", () => {
  it("runs a total across the period, carrying quiet days forward", () => {
    const series = cumulativeByDay(
      [
        { date: "2026-10-01", expenses: 10 },
        { date: "2026-10-03", expenses: 5 },
      ],
      "2026-10-01",
      "2026-10-04",
      NOW,
    );
    expect(series).toEqual([10, 10, 15, 15]);
  });

  it("stops at today while the period is still running", () => {
    // Nov 1–30 with today the 22nd: 22 points, not 30 flat ones.
    const series = cumulativeByDay(
      [{ date: "2026-11-01", expenses: 100 }],
      "2026-11-01",
      "2026-11-30",
      NOW,
    );
    expect(series).toHaveLength(22);
    expect(series.at(-1)).toBe(100);
  });

  it("ignores transactions outside the period", () => {
    const series = cumulativeByDay(
      [
        { date: "2026-09-30", expenses: 999 },
        { date: "2026-10-02", expenses: 7 },
        { date: "2026-10-05", expenses: 999 },
      ],
      "2026-10-01",
      "2026-10-03",
      NOW,
    );
    expect(series).toEqual([0, 7, 7]);
  });

  it("has nothing to draw for an unbounded range", () => {
    expect(cumulativeByDay([{ date: "2026-10-01", expenses: 10 }], "", "", NOW)).toEqual([]);
  });
});
