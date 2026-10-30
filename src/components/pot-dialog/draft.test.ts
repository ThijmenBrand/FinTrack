import { describe, expect, it } from "vitest";
import { POT_BUDGET_ERROR } from "@/lib/pot-budget";
import {
  addCategory,
  addFromUnplanned,
  addLine,
  addSubLine,
  copyFrom,
  draftAllocation,
  draftChanged,
  draftFromTree,
  emptyDraft,
  formatAmount,
  matchTotalToLines,
  parseAmount,
  removeCategory,
  removeLine,
  toPayload,
  updateLine,
  usedCategoryIds,
  validateDraft,
  type PotBudgetDraft,
} from "./draft";

const TREE = {
  total: 2000,
  lines: [
    { name: "Flights", amount: 400, categoryIds: ["c-flights"], children: [] },
    { name: "Hotel", amount: 800, categoryIds: ["c-hotel"], children: [] },
    {
      name: "Food",
      amount: 800,
      categoryIds: ["c-snacks"],
      children: [
        { name: "Dining", amount: 500.5, categoryIds: ["c-food"], children: [] },
        { name: "Groceries", amount: 299.5, categoryIds: [], children: [] },
      ],
    },
  ],
};

const vacation = () => draftFromTree(TREE, "2027-07-12");
const keyOf = (d: PotBudgetDraft, name: string) => {
  for (const l of d.lines) {
    if (l.name === name) return l.key;
    for (const c of l.children) if (c.name === name) return c.key;
  }
  throw new Error(name);
};

describe("amount text", () => {
  it("parses typed amounts, comma decimals included", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("abc")).toBeNaN();
  });
  it("formats whole euros bare and cents with two decimals", () => {
    expect(formatAmount(400)).toBe("400");
    expect(formatAmount(500.5)).toBe("500.50");
    expect(formatAmount(0.1 + 0.2)).toBe("0.30");
  });
});

describe("draftFromTree / toPayload", () => {
  it("round-trips a saved budget", () => {
    const d = vacation();
    expect(d.total).toBe("2000");
    expect(d.targetDate).toBe("2027-07-12");
    expect(toPayload(d)).toEqual({ ...TREE, targetDate: "2027-07-12" });
    expect(validateDraft(d).ok).toBe(true);
  });

  it("sends an empty leaf as NaN so validation names it, and no total as null", () => {
    const d = addLine({ ...emptyDraft(), total: "" }, { name: "A" });
    expect(toPayload(d).total).toBeNull();
    expect(toPayload(d).lines[0].amount).toBeNaN();
    expect(toPayload(d).targetDate).toBeNull();
    const r = validateDraft({ ...d, total: "10" });
    expect(r.ok ? null : r.error).toBe(POT_BUDGET_ERROR.lineAmount);
  });

  it("derives a parent's amount from its sub-lines", () => {
    const d = vacation();
    const edited = updateLine(d, keyOf(d, "Dining"), { amount: "600.5" });
    expect(toPayload(edited).lines[2].amount).toBe(900);
  });
});

describe("draftAllocation", () => {
  it("reports each state", () => {
    expect(draftAllocation(emptyDraft()).state).toBe("noLines");
    const d = vacation();
    expect(draftAllocation(d)).toEqual({ state: "match", planned: 2000, total: 2000, diff: 0 });
    expect(draftAllocation({ ...d, total: "2150" })).toMatchObject({ state: "under", diff: 150 });
    expect(draftAllocation({ ...d, total: "1900.5" })).toMatchObject({ state: "over", diff: -99.5 });
    expect(draftAllocation({ ...d, total: "" }).state).toBe("noTotal");
  });

  it("blocks saving until the lines match the total", () => {
    const r = validateDraft({ ...vacation(), total: "2100" });
    expect(r.ok ? null : r.error).toBe(POT_BUDGET_ERROR.sumMismatch);
    expect(validateDraft(matchTotalToLines({ ...vacation(), total: "2100" })).ok).toBe(true);
  });
});

describe("editing lines", () => {
  it("a new line takes whatever is still unallocated", () => {
    expect(addLine({ ...emptyDraft(), total: "500" }).lines[0].amount).toBe("500");
    const under = addLine({ ...vacation(), total: "2150" });
    expect(under.lines.at(-1)!.amount).toBe("150");
    expect(validateDraft({ ...under, lines: under.lines.map((l, i) => (i === 3 ? { ...l, name: "Other" } : l)) }).ok).toBe(true);
    // Fully allocated or over: starts empty.
    expect(addLine(vacation()).lines.at(-1)!.amount).toBe("");
  });

  it("the first sub-line inherits its parent's amount, later ones start empty", () => {
    const d = vacation();
    const hotel = keyOf(d, "Hotel");
    const one = addSubLine(d, hotel);
    expect(one.lines[1].children.map((c) => c.amount)).toEqual(["800"]);
    const two = addSubLine(one, hotel);
    expect(two.lines[1].children.map((c) => c.amount)).toEqual(["800", ""]);
    expect(draftAllocation(two).state).toBe("match");
  });

  it("removing the last sub-line hands its amount back to the parent", () => {
    let d = vacation();
    d = removeLine(d, keyOf(d, "Groceries"));
    expect(draftAllocation(d)).toMatchObject({ state: "under", diff: 299.5 });
    d = removeLine(d, keyOf(d, "Dining"));
    const food = d.lines[2];
    expect(food.children).toEqual([]);
    expect(food.amount).toBe("500.50");
  });

  it("removing a parent drops its sub-lines and their categories", () => {
    const d = vacation();
    const removed = removeLine(d, keyOf(d, "Food"));
    expect(removed.lines.map((l) => l.name)).toEqual(["Flights", "Hotel"]);
    expect(usedCategoryIds(removed)).toEqual(new Set(["c-flights", "c-hotel"]));
  });

  it("keeps a category on one line only", () => {
    const d = vacation();
    expect(addCategory(d, keyOf(d, "Hotel"), "c-flights")).toBe(d);
    const added = addCategory(d, keyOf(d, "Groceries"), "c-market");
    expect(added.lines[2].children[1].categoryIds).toEqual(["c-market"]);
    const removed = removeCategory(added, keyOf(added, "Flights"), "c-flights");
    expect(removed.lines[0].categoryIds).toEqual([]);
    expect(usedCategoryIds(removed).has("c-flights")).toBe(false);
  });
});

describe("addFromUnplanned", () => {
  it("adds the category as a line at what it cost, leaving the lines over", () => {
    const d = addFromUnplanned(vacation(), { id: "c-gifts", name: "Gifts" }, 35.2);
    expect(d.lines.at(-1)).toMatchObject({ name: "Gifts", amount: "35.20", categoryIds: ["c-gifts"] });
    expect(draftAllocation(d)).toMatchObject({ state: "over", diff: -35.2 });
  });

  it("does nothing for a category a line already has", () => {
    const d = vacation();
    expect(addFromUnplanned(d, { id: "c-hotel", name: "Hotel" }, 10)).toBe(d);
  });

  it("plans a refund-only category at zero, not negative", () => {
    expect(addFromUnplanned(vacation(), { id: "c-x", name: "X" }, -20).lines.at(-1)!.amount).toBe("");
  });
});

describe("copyFrom", () => {
  it("takes the other pot's lines and total but keeps this pot's date", () => {
    const d = copyFrom({ ...emptyDraft(), targetDate: "2028-01-01" }, TREE);
    expect(toPayload(d)).toEqual({ ...TREE, targetDate: "2028-01-01" });
  });

  it("gives the copied lines their own keys", () => {
    const a = copyFrom(emptyDraft(), TREE);
    const b = copyFrom(emptyDraft(), TREE);
    expect(a.lines[0].key).not.toBe(b.lines[0].key);
  });
});

describe("draftChanged", () => {
  it("ignores formatting and catches real edits", () => {
    const d = vacation();
    expect(draftChanged(d, vacation())).toBe(false);
    expect(draftChanged({ ...d, total: "2000.00" }, d)).toBe(false);
    expect(draftChanged(updateLine(d, keyOf(d, "Hotel"), { name: " Hotel " }), d)).toBe(false);
    expect(draftChanged({ ...d, targetDate: "" }, d)).toBe(true);
    expect(draftChanged(updateLine(d, keyOf(d, "Hotel"), { amount: "801" }), d)).toBe(true);
    expect(draftChanged(removeCategory(d, keyOf(d, "Hotel"), "c-hotel"), d)).toBe(true);
  });
});
