import { describe, it, expect } from "vitest";
import {
  addLine,
  removeLine,
  sumLines,
  toChildInput,
  toLineNodes,
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

describe("toLineNodes", () => {
  it("derives a container's amount from its children", () => {
    const nodes = toLineNodes([draft("a", 1200, [draft("a1", 30)])]);
    expect(nodes[0].amount).toBe(30);
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
});
