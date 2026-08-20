import { describe, it, expect } from "vitest";
import { fixedCostBudgetLines, walkBalanceBack } from "./dashboard-queries";

describe("walkBalanceBack", () => {
  it("ends at today's balance and rewinds to the window start", () => {
    // 100 at the window start, +50 on the 5th, -20 on the 12th → 130 today.
    const points = walkBalanceBack(
      130,
      new Map([
        ["2026-01-05", 50],
        ["2026-01-12", -20],
      ]),
      "2026-01-01",
      "2026-01-15",
    );

    expect(points[0]).toEqual({ date: "2026-01-01", value: 100 });
    expect(points.at(-1)).toEqual({ date: "2026-01-15", value: 130 });
    // Weekly samples + today.
    expect(points.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
    expect(points[1].value).toBe(150); // after the +50, before the -20
  });

  it("subtracts future-dated transactions from the starting balance", () => {
    // currentBalance includes a future +40 that must not show up in the window.
    const points = walkBalanceBack(
      140,
      new Map([["2026-02-01", 40]]),
      "2026-01-01",
      "2026-01-08",
    );

    expect(points).toEqual([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-08", value: 100 },
    ]);
  });
});

describe("fixedCostBudgetLines", () => {
  const plan = (categoryId: string | null, amount: number, frequency = "monthly") => ({
    categoryId,
    categoryName: categoryId,
    categoryColor: null,
    categoryIcon: null,
    amount,
    frequency,
  });

  it("gives a recurring-only category one row capped at its monthly plans", () => {
    const lines = fixedCostBudgetLines(
      [plan("drinks", 55), plan("subs", 16.12), plan("subs", 3)],
      new Set(),
      new Map([["drinks", 551.47]]),
    );

    expect(lines).toEqual([
      expect.objectContaining({ categoryId: "drinks", limit: 55, spent: 551.47 }),
      expect.objectContaining({ categoryId: "subs", limit: 19.12, spent: 0 }),
    ]);
  });

  it("leaves allocated and category-less plans out", () => {
    const lines = fixedCostBudgetLines(
      [plan("rent", 449.5), plan(null, 10)],
      new Set(["rent"]),
      new Map(),
    );

    expect(lines).toEqual([]);
  });
});
