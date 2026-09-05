import { describe, it, expect } from "vitest";
import {
  addLine,
  linkedPlanIds,
  removeLine,
  sumLines,
  toChildInput,
  toLineNodes,
  adoptDrafts,
  uncoveredMonthly,
  updateLine,
  type DraftLine,
} from "./draft";
import type { BudgetSubLine } from "@/types/api";

function draft(
  id: string,
  amount: number,
  children: DraftLine[] = [],
): DraftLine {
  return { id, name: id, amount, children };
}

describe("sumLines", () => {
  it("adds up leaves", () => {
    expect(sumLines([draft("a", 10), draft("b", 5.5)])).toBe(15.5);
  });

  it("prefers a container's children over its own stored amount", () => {
    // The inversion: a parent that was written before roll-up existed still
    // reads as its children, not as the figure someone typed years ago.
    const tree = [draft("a", 1200, [draft("a1", 400), draft("a2", 499)])];
    expect(sumLines(tree)).toBe(899);
  });

  it("recurses to the deepest level", () => {
    const tree = [draft("a", 0, [draft("a1", 0, [draft("a1a", 7)])])];
    expect(sumLines(tree)).toBe(7);
  });

  it("reads a saved sub-line tree the same way", () => {
    const saved: BudgetSubLine[] = [
      {
        id: "s",
        parentId: null,
        name: "s",
        amount: 999,
        children: [
          { id: "s1", parentId: "s", name: "s1", amount: 20, children: [] },
        ],
      },
    ];
    expect(sumLines(saved)).toBe(20);
  });

  it("is zero for an empty tree, so an untouched allocation stays typeable", () => {
    expect(sumLines([])).toBe(0);
  });
});

describe("tree edits", () => {
  const tree = [draft("a", 10, [draft("a1", 4)]), draft("b", 2)];

  it("appends to the roots", () => {
    expect(addLine(tree, null, draft("c", 1)).map((l) => l.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("appends into a nested container", () => {
    const next = addLine(tree, "a1", draft("a1a", 1));
    expect(next[0].children[0].children.map((l) => l.id)).toEqual(["a1a"]);
    expect(sumLines(next)).toBe(3);
  });

  it("patches a nested line without touching its siblings", () => {
    const next = updateLine(tree, "a1", { amount: 9 });
    expect(sumLines(next)).toBe(11);
    expect(next[1]).toEqual(tree[1]);
  });

  it("removes a line at any depth", () => {
    expect(removeLine(tree, "a1")[0].children).toEqual([]);
    expect(removeLine(tree, "b").map((l) => l.id)).toEqual(["a"]);
  });

  it("leaves the input alone", () => {
    removeLine(tree, "a1");
    updateLine(tree, "a1", { amount: 9 });
    expect(sumLines(tree)).toBe(6);
  });
});

describe("linkedPlanIds", () => {
  it("collects adopted and to-be-created plans at every depth", () => {
    const tree: DraftLine[] = [
      { ...draft("a", 0), adoptRecurringId: "plan-1" },
      draft("b", 0, [
        {
          ...draft("b1", 0),
          recurring: {
            accountId: "acc",
            amount: 10,
            frequency: "monthly",
            startDate: "2026-01-01",
          },
        },
      ]),
    ];
    // The drafted plan has no id yet — there is nothing to exclude for it.
    expect([...linkedPlanIds(tree)]).toEqual(["plan-1"]);
  });

  it("collects saved links too", () => {
    const saved: BudgetSubLine[] = [
      {
        id: "s",
        parentId: null,
        name: "s",
        amount: 10,
        children: [],
        recurring: {
          id: "plan-2",
          amount: -10,
          frequency: "monthly",
          dayOfWeek: null,
          dayOfMonth: 1,
          monthOfYear: null,
          startDate: "2026-01-01",
          isActive: true,
        },
      },
    ];
    expect([...linkedPlanIds(saved)]).toEqual(["plan-2"]);
  });
});

describe("toLineNodes", () => {
  const plan = {
    frequency: "yearly",
    dayOfWeek: null,
    dayOfMonth: 3,
    monthOfYear: 6,
    startDate: "2026-06-03",
  };

  it("derives a container's amount from its children", () => {
    const nodes = toLineNodes([draft("a", 1200, [draft("a1", 30)])], () => undefined);
    expect(nodes[0].amount).toBe(30);
  });

  it("resolves an adopted line's plan for display", () => {
    const tree: DraftLine[] = [{ ...draft("a", 50), adoptRecurringId: "p" }];
    expect(toLineNodes(tree, () => plan)[0].recurring).toEqual(plan);
  });

  it("shows a drafted plan before it exists", () => {
    const tree: DraftLine[] = [
      {
        ...draft("a", 50),
        recurring: {
          accountId: "acc",
          amount: 600,
          frequency: "yearly",
          dayOfMonth: 3,
          monthOfYear: 6,
          startDate: "2026-06-03",
        },
      },
    ];
    expect(toLineNodes(tree, () => undefined)[0].recurring).toEqual(plan);
  });
});

describe("toChildInput", () => {
  it("sends a container's derived total and nests its children", () => {
    const payload = toChildInput([draft("a", 1200, [draft("a1", 20), draft("a2", 5)])]);
    expect(payload).toEqual([
      {
        name: "a",
        amount: 25,
        children: [
          { name: "a1", amount: 20 },
          { name: "a2", amount: 5 },
        ],
      },
    ]);
  });

  it("carries the recurring halves through untouched", () => {
    const recurring = {
      accountId: "acc",
      amount: 600,
      frequency: "yearly" as const,
      startDate: "2026-06-03",
    };
    expect(
      toChildInput([
        { ...draft("a", 50), recurring },
        { ...draft("b", 12), adoptRecurringId: "p" },
      ]),
    ).toEqual([
      { name: "a", amount: 50, recurring },
      { name: "b", amount: 12, adoptRecurringId: "p" },
    ]);
  });
});

describe("adoptDrafts", () => {
  // Same conversion as uncoveredMonthly below: stored negative, per
  // occurrence, out positive and monthly.
  const rent = {
    id: "rent",
    description: "Huur woning",
    amount: -1250,
    frequency: "monthly",
    isActive: true,
  };
  const weekly = { ...rent, id: "cleaner", description: "Cleaner", amount: -25, frequency: "weekly" };

  it("seeds one adopting line per active plan, in monthly units", () => {
    const lines = adoptDrafts([rent, weekly, { ...rent, id: "paused", isActive: false }]);
    expect(lines.map((l) => l.adoptRecurringId)).toEqual(["rent", "cleaner"]);
    expect(lines[0].name).toBe("Huur woning");
    expect(lines[0].amount).toBe(1250);
    expect(lines[1].amount).toBeCloseTo(25 * 4.33, 2);
  });
});

describe("uncoveredMonthly", () => {
  // Recurring expenses are stored negative and per occurrence; a budget line
  // is positive and monthly. Both conversions have to happen or the warning
  // fires on the wrong side of the comparison.
  const rent = { id: "rent", amount: -1250, frequency: "monthly", isActive: true };
  const weekly = { id: "cleaner", amount: -25, frequency: "weekly", isActive: true };

  it("sums the plans no line stands for, monthly and positive", () => {
    expect(uncoveredMonthly([rent, weekly], new Set())).toBeCloseTo(1250 + 25 * 4.33, 2);
  });

  it("subtracts the ones already adopted", () => {
    expect(uncoveredMonthly([rent, weekly], new Set(["rent"]))).toBeCloseTo(108.25, 2);
  });

  it("ignores paused plans — they take nothing this month", () => {
    expect(uncoveredMonthly([{ ...rent, isActive: false }], new Set())).toBe(0);
  });
});
