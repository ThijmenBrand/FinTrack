import { describe, it, expect } from "vitest";
import {
  hasLine,
  patchBudget,
  removeLine,
  reprice,
  rollUp,
  upsertAllocation,
  withSubLines,
} from "./budget-cache";
import type { Allocation, BudgetData, BudgetSubLine } from "@/types/api";

function alloc(id: string, amount: number, spent = 0): Allocation {
  return {
    id,
    categoryId: `cat-${id}`,
    categoryName: id,
    categoryColor: null,
    amount,
    spent,
    remaining: 0,
    percentage: 0,
    status: "ok",
    avgMonthly: 0,
    avgMonths: 0,
    subLines: [],
  };
}

function line(
  id: string,
  amount: number,
  children: BudgetSubLine[] = [],
): BudgetSubLine {
  return { id, parentId: null, name: id, amount, children };
}

/** Only what `patchBudget` reads; it spreads the rest through untouched. */
function payload(over: Partial<BudgetData>): BudgetData {
  return {
    allocations: [],
    availableToAllocate: 1000,
    totalFixedCosts: 200,
    unbudgetedSpending: [],
    yearly: null,
    ...over,
  } as BudgetData;
}

describe("reprice", () => {
  it("derives the thresholds the endpoint derives", () => {
    expect(reprice(alloc("a", 100, 79)).status).toBe("ok");
    expect(reprice(alloc("a", 100, 80)).status).toBe("warning");
    expect(reprice(alloc("a", 100, 100)).status).toBe("exceeded");
  });

  it("floors what is left at zero and rounds the percentage to a tenth", () => {
    const over = reprice(alloc("a", 100, 133.33));
    expect(over.remaining).toBe(0);
    expect(over.percentage).toBe(133.3);
  });
});

describe("patchBudget", () => {
  it("moves the plan totals with the allocations", () => {
    const data = payload({ allocations: [alloc("a", 300), alloc("b", 100)] });
    const next = patchBudget(data, (list) =>
      list.map((a) => (a.id === "a" ? { ...a, amount: 400 } : a)),
    );
    expect(next.totalAllocated).toBe(500);
    expect(next.unallocated).toBe(500); // 1000 available − 500
    expect(next.totalBudget).toBe(700); // 200 fixed + 500
  });

  it("puts a delete through the totals too", () => {
    const data = payload({ allocations: [alloc("a", 300), alloc("b", 100)] });
    const next = patchBudget(data, (list) => list.filter((a) => a.id !== "a"));
    expect(next.allocations.map((a) => a.id)).toEqual(["b"]);
    expect(next.totalAllocated).toBe(100);
  });
});

describe("patchBudget on a yearly plan", () => {
  // Two months closed at 100, ten still open, nothing spent but January's 60.
  const months = Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    from: `2026-${String(monthIndex + 1).padStart(2, "0")}-01`,
    to: `2026-${String(monthIndex + 1).padStart(2, "0")}-28`,
    closed: monthIndex < 2,
    target: 100,
    spent: monthIndex === 0 ? 60 : 0,
    rolloverIn: 0,
    rolloverOut: 0,
    allowance: 100,
  }));

  const data = payload({
    allocations: [{ ...alloc("a", 100), categoryId: "cat-a" }],
    yearly: {
      year: 2026,
      monthIndex: 2,
      from: "2026-01-01",
      to: "2026-12-28",
      monthFrom: "2026-03-01",
      monthTo: "2026-03-28",
      income: {
        actual: 0,
        projected: 0,
        total: 0,
        monthsBanked: 0,
        monthsProjected: 0,
      },
      totals: {
        annualPot: 1200,
        spentYear: 60,
        remainingYear: 1140,
        allowanceThisMonth: 240,
        spentThisMonth: 0,
        rolloverIntoThisMonth: 140,
      },
      categories: [
        {
          categoryId: "cat-a",
          categoryName: "a",
          categoryColor: null,
          annualAmount: 1200,
          monthTarget: 100,
          rolloverIn: 140,
          allowance: 240,
          spentMonth: 0,
          spentYear: 60,
          remainingYear: 1140,
          status: "ok",
          months,
        },
      ],
    },
  });

  it("gives a raise to the open months only", () => {
    const next = patchBudget(data, (list) =>
      list.map((a) => ({ ...a, amount: 200 })),
    );
    const category = next.yearly!.categories[0];
    // Two closed months keep 100, the other ten move to 200.
    expect(category.annualAmount).toBe(2200);
    // March's own target doubled, and it still carries January's unspent 40
    // plus February's whole 100.
    expect(category.monthTarget).toBe(200);
    expect(category.rolloverIn).toBe(140);
    expect(category.allowance).toBe(340);
    expect(next.yearly!.totals.annualPot).toBe(2200);
  });

  it("drops the envelope of a deleted allocation", () => {
    const next = patchBudget(data, () => []);
    expect(next.yearly!.categories).toEqual([]);
    expect(next.yearly!.totals.annualPot).toBe(0);
  });

  it("leaves an untouched envelope exactly as it was", () => {
    const next = patchBudget(data, (list) => list);
    expect(next.yearly!.categories[0]).toBe(data.yearly!.categories[0]);
  });
});

describe("sub-line roll-up", () => {
  it("makes every container its children, at every depth", () => {
    const tree = [line("a", 999, [line("a1", 4, [line("a1a", 7)])]), line("b", 2)];
    const rolled = rollUp(tree);
    expect(rolled[0].amount).toBe(7);
    expect(rolled[0].children[0].amount).toBe(7);
  });

  it("re-sums the allocation from its roots", () => {
    const a = { ...alloc("a", 999), subLines: [line("x", 30), line("y", 12)] };
    expect(withSubLines(a, a.subLines).amount).toBe(42);
  });

  it("leaves the amount alone once the last child goes", () => {
    // The endpoint's `count > 0` guard: removing the last line must not zero
    // a budget that is still meant to cap the category.
    const a = { ...alloc("a", 250), subLines: [line("x", 30)] };
    expect(withSubLines(a, removeLine(a.subLines, "x")).amount).toBe(250);
  });

  it("finds a line at any depth", () => {
    const tree = [line("a", 1, [line("a1", 1)])];
    expect(hasLine(tree, "a1")).toBe(true);
    expect(hasLine(tree, "nope")).toBe(false);
  });
});

describe("upsertAllocation", () => {
  const row = {
    categoryId: "cat-a",
    categoryName: "a",
    categoryColor: null,
    amount: 250,
    spent: 40,
  };

  it("re-uses the category's existing row — the endpoint upserts", () => {
    const next = upsertAllocation([alloc("a", 100, 40)], row);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("a");
    expect(next[0].amount).toBe(250);
    expect(next[0].pending).toBe(true);
  });

  it("appends a pending row for a category with no allocation yet", () => {
    const next = upsertAllocation([], row);
    expect(next[0].pending).toBe(true);
    expect(next[0].spent).toBe(40);
    // Derived once the row goes through patchBudget.
    expect(reprice(next[0]).percentage).toBe(16);
  });
});
