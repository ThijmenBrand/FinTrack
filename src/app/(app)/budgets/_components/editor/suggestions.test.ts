import { describe, it, expect } from "vitest";
import { EMPTY_DRAFT, changeCount, overlay, toSteps, afterSave } from "./draft";
import {
  acceptSuggestion,
  acceptedOn,
  declineSuggestion,
  pendingSuggestions,
  suggestedKey,
  undoSuggestion,
} from "./suggestions";
import type { Allocation, BudgetSubLine, BudgetSuggestion } from "@/types/api";

function alloc(id: string, amount: number, subLines: BudgetSubLine[] = []): Allocation {
  return {
    id,
    categoryId: `cat-${id}`,
    categoryName: id,
    categoryColor: null,
    amount,
    spent: 0,
    remaining: amount,
    percentage: 0,
    status: "ok",
    avgMonthly: 0,
    avgMonths: 0,
    subLines,
  };
}

function suggestion(id: string, categoryId: string, suggestedAmount: number): BudgetSuggestion {
  return {
    id,
    categoryId,
    categoryName: categoryId,
    categoryColor: null,
    suggestedAmount,
    currentAmount: null,
    avgMonthly: suggestedAmount,
    monthsOfData: 3,
    generatedAt: null,
  };
}

const allocations = [alloc("a", 100)];

describe("acceptSuggestion", () => {
  it("drafts the suggested amount over the category's row", () => {
    const d = acceptSuggestion(EMPTY_DRAFT, suggestion("s1", "cat-a", 150), allocations);
    expect(overlay(allocations, d)[0].amount).toBe(150);
    expect(acceptedOn(d, "a")).toBe("s1");
    // One change: the amount. Clearing the suggestion is bookkeeping.
    expect(changeCount(d)).toBe(1);
  });

  it("adds a row for a category the plan doesn't have", () => {
    const d = acceptSuggestion(EMPTY_DRAFT, suggestion("s1", "cat-z", 40), allocations);
    const rows = overlay(allocations, d);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: suggestedKey("s1"), amount: 40, isNew: true });
    expect(toSteps(d).map((s) => s.kind)).toEqual(["dismiss", "create"]);
  });

  it("leaves a row whose total comes from its lines alone", () => {
    const derived = [alloc("a", 30, [{ id: "l", parentId: null, name: "l", amount: 30, children: [] }])];
    const d = acceptSuggestion(EMPTY_DRAFT, suggestion("s1", "cat-a", 150), derived);
    expect(d).toBe(EMPTY_DRAFT);
  });

  it("treats a row being removed as absent, and adds a fresh one", () => {
    const d = acceptSuggestion(
      { ...EMPTY_DRAFT, removed: ["a"] },
      suggestion("s1", "cat-a", 150),
      allocations,
    );
    expect(toSteps(d).map((s) => s.kind)).toEqual(["dismiss", "remove", "create"]);
  });
});

describe("declineSuggestion", () => {
  it("counts as one change and clears the suggestion on save", () => {
    const d = declineSuggestion(EMPTY_DRAFT, "s1");
    expect(changeCount(d)).toBe(1);
    expect(toSteps(d)).toEqual([{ kind: "dismiss", ids: ["s1"] }]);
    expect(pendingSuggestions([suggestion("s1", "cat-a", 1)], d)).toEqual([]);
  });
});

describe("undoSuggestion", () => {
  it("puts back the amount an accept typed over", () => {
    const typed = { ...EMPTY_DRAFT, amounts: { a: 120 } };
    const d = undoSuggestion(
      acceptSuggestion(typed, suggestion("s1", "cat-a", 150), allocations),
      "s1",
    );
    expect(d.amounts).toEqual({ a: 120 });
    expect(d.decided).toEqual({});
  });

  it("drops the amount entirely when none was typed before", () => {
    const d = undoSuggestion(
      acceptSuggestion(EMPTY_DRAFT, suggestion("s1", "cat-a", 150), allocations),
      "s1",
    );
    expect(changeCount(d)).toBe(0);
  });

  it("takes away the row an accept added", () => {
    const d = undoSuggestion(
      acceptSuggestion(EMPTY_DRAFT, suggestion("s1", "cat-z", 40), allocations),
      "s1",
    );
    expect(d.added).toEqual([]);
    expect(changeCount(d)).toBe(0);
  });

  it("returns a declined suggestion to the review", () => {
    const d = undoSuggestion(declineSuggestion(EMPTY_DRAFT, "s1"), "s1");
    expect(d).toEqual(EMPTY_DRAFT);
  });
});

describe("afterSave", () => {
  it("forgets the answers once the suggestions are cleared, keeping unsaved edits", () => {
    const d = acceptSuggestion(EMPTY_DRAFT, suggestion("s1", "cat-a", 150), allocations);
    const steps = toSteps(d);
    // The dismiss landed; the amount after it did not.
    const left = afterSave(d, steps, 1, {});
    expect(left.decided).toEqual({});
    expect(left.amounts).toEqual({ a: 150 });
  });
});
