import { describe, it, expect } from "vitest";
import {
  afterSave,
  applyOps,
  changeCount,
  overlay,
  toSteps,
  type Draft,
  type SubLineOp,
} from "./draft";
import type { Allocation, BudgetSubLine } from "@/types/api";

const EMPTY: Draft = { amounts: {}, removed: [], added: [], ops: [] };

function line(id: string, amount: number, children: BudgetSubLine[] = []): BudgetSubLine {
  return { id, parentId: null, name: id, amount, children };
}

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

describe("overlay", () => {
  it("shows the typed amount over the saved one", () => {
    const rows = overlay([alloc("a", 100)], { ...EMPTY, amounts: { a: 250 } });
    expect(rows[0].amount).toBe(250);
    expect(rows[0].removed).toBe(false);
  });

  it("keeps a removed row in the list, struck through", () => {
    const rows = overlay([alloc("a", 100)], { ...EMPTY, removed: ["a"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].removed).toBe(true);
  });

  it("rolls a container up from its children rather than the typed field", () => {
    const rows = overlay([alloc("a", 100, [line("s1", 30), line("s2", 20)])], {
      ...EMPTY,
      // Ignored: the breakdown owns the total once there is one.
      amounts: { a: 999 },
    });
    expect(rows[0].amount).toBe(50);
  });

  it("renders an added row with no spend of its own", () => {
    const rows = overlay([], {
      ...EMPTY,
      added: [
        {
          key: "new-1",
          categoryId: "c1",
          categoryName: "Books",
          categoryColor: "#000",
          amount: 40,
          lines: [],
        },
      ],
    });
    expect(rows[0]).toMatchObject({ amount: 40, spent: 0, isNew: true });
  });
});

describe("applyOps", () => {
  it("adds, nests, updates and removes, re-totalling as it goes", () => {
    const ops: SubLineOp[] = [
      { kind: "add", allocationId: "a", parentId: null, id: "l1", name: "Gas", amount: 60 },
      { kind: "add", allocationId: "a", parentId: "l1", id: "l2", name: "Shell", amount: 25 },
      { kind: "update", allocationId: "a", id: "l2", name: "Shell", amount: 30 },
    ];
    const tree = applyOps([], ops);
    expect(tree).toHaveLength(1);
    // The parent is its children, so the 60 it was added with gives way.
    expect(tree[0].amount).toBe(30);
    expect(tree[0].children[0].name).toBe("Shell");

    const after = applyOps([], [...ops, { kind: "remove", allocationId: "a", id: "l2" }]);
    // A container with no children left keeps its own amount, like the server.
    expect(after[0].children).toHaveLength(0);
    expect(after[0].amount).toBe(60);
  });
});

describe("toSteps", () => {
  it("deletes before it creates, so a freed category can be re-budgeted", () => {
    const steps = toSteps({
      ...EMPTY,
      removed: ["a"],
      added: [
        {
          key: "k",
          categoryId: "cat-a",
          categoryName: "A",
          categoryColor: null,
          amount: 50,
          lines: [],
        },
      ],
    });
    expect(steps.map((s) => s.kind)).toEqual(["remove", "create"]);
  });

  it("drops the amount and the sub-line ops of a row being deleted", () => {
    const steps = toSteps({
      amounts: { a: 10 },
      removed: ["a"],
      added: [],
      ops: [{ kind: "remove", allocationId: "a", id: "l1" }],
    });
    expect(steps).toEqual([{ kind: "remove", id: "a" }]);
  });

  it("never asks the server to delete a row it never created", () => {
    const steps = toSteps({
      ...EMPTY,
      removed: ["k"],
      added: [
        {
          key: "k",
          categoryId: "c",
          categoryName: "A",
          categoryColor: null,
          amount: 5,
          lines: [],
        },
      ],
    });
    expect(steps).toEqual([]);
  });

  it("never asks the server to delete a sub-line it never created", () => {
    const ops: SubLineOp[] = [
      { kind: "add", allocationId: "a", parentId: null, id: "l1", name: "Gas", amount: 40 },
      { kind: "add", allocationId: "a", parentId: "l1", id: "l2", name: "Winter", amount: 10 },
      { kind: "update", allocationId: "a", id: "l2", name: "Winter", amount: 15 },
      { kind: "remove", allocationId: "a", id: "l1" },
      { kind: "add", allocationId: "a", parentId: null, id: "l3", name: "Water", amount: 20 },
    ];
    // l1 and everything drafted under it cancel out; l3 survives.
    expect(toSteps({ ...EMPTY, ops })).toEqual([
      { kind: "op", op: ops[4] },
    ]);
  });
});

describe("afterSave", () => {
  const draft: Draft = {
    amounts: { a: 10, b: 20 },
    removed: [],
    added: [],
    ops: [],
  };

  it("clears the whole draft when every step landed", () => {
    const steps = toSteps(draft);
    expect(changeCount(afterSave(draft, steps, steps.length, {}))).toBe(0);
  });

  it("keeps only what did not happen when a step fails halfway", () => {
    const steps = toSteps(draft);
    const left = afterSave(draft, steps, 1, {});
    expect(Object.keys(left.amounts)).toHaveLength(1);
    expect(left.amounts[steps[1].kind === "amount" ? steps[1].id : ""]).toBe(
      steps[1].kind === "amount" ? steps[1].amount : undefined,
    );
  });

  it("drops an amount typed over a row this run deleted", () => {
    // Otherwise the retry PUTs an id the server no longer has, and the 404
    // blocks every step queued behind it.
    const d: Draft = { ...EMPTY, amounts: { a: 500, b: 200 }, removed: ["a"] };
    const steps = toSteps(d);
    // The delete landed; the amount on `b` behind it did not.
    const left = afterSave(d, steps, 1, {});
    expect(left.amounts).toEqual({ b: 200 });
    expect(toSteps(left)).toEqual([{ kind: "amount", id: "b", amount: 200 }]);
  });

  it("repoints a waiting op at the id the server issued for its parent", () => {
    const ops: SubLineOp[] = [
      { kind: "add", allocationId: "a", parentId: null, id: "local-1", name: "Gas", amount: 60 },
      { kind: "add", allocationId: "a", parentId: "local-1", id: "local-2", name: "Shell", amount: 25 },
    ];
    const d: Draft = { ...EMPTY, ops };
    const steps = toSteps(d);
    // The first add landed and came back as `real-1`; the second never ran.
    const left = afterSave(d, steps, 1, { "local-1": "real-1" });
    expect(left.ops).toHaveLength(1);
    expect(left.ops[0]).toMatchObject({ id: "local-2", parentId: "real-1" });
  });
});

describe("changeCount", () => {
  it("ignores an amount typed over a row that is being deleted", () => {
    expect(
      changeCount({ ...EMPTY, amounts: { a: 500 }, removed: ["a"] }),
    ).toBe(1);
  });

  it("counts a row added and removed again as no change at all", () => {
    expect(
      changeCount({
        ...EMPTY,
        removed: ["k"],
        added: [
          {
            key: "k",
            categoryId: "c",
            categoryName: "A",
            categoryColor: null,
            amount: 5,
            lines: [],
          },
        ],
      }),
    ).toBe(0);
  });
});
