import { describe, it, expect } from "vitest";
import {
  afterSave,
  applyOps,
  changeCount,
  filePlan,
  filedIds,
  linkable,
  overlay,
  toSteps,
  unfilePlan,
  type Draft,
  type SubLineOp,
} from "./draft";
import type { Allocation, BudgetSubLine, RecurringTx } from "@/types/api";

const EMPTY: Draft = { amounts: {}, removed: [], added: [], ops: [], recurring: [] };

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
  it("creates a category added at zero from its breakdown alone", () => {
    const steps = toSteps({
      ...EMPTY,
      added: [
        {
          key: "k",
          categoryId: "cat-a",
          categoryName: "Appartment",
          categoryColor: null,
          // Left at 0 on the add row: the sub-lines are the cap.
          amount: 0,
          lines: [
            { id: "l1", name: "Rent", amount: 900, children: [] },
            { id: "l2", name: "Gas", amount: 100, children: [] },
          ],
        },
      ],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "create", amount: 1000 });
  });

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
      recurring: [],
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

describe("drafted recurring payments", () => {
  const tx = { id: "draft:1", type: "expense", amount: -10 } as RecurringTx;

  it("counts as a change", () => {
    const draft: Draft = { ...EMPTY, amounts: { a: 1 }, recurring: [tx] };
    expect(changeCount(draft)).toBe(2);
    expect(toSteps(draft).map((s) => s.kind)).toEqual(["amount", "recurring"]);
  });

  it("is dropped once written, and kept when the step never ran", () => {
    const draft: Draft = { ...EMPTY, recurring: [tx] };
    const steps = toSteps(draft);
    expect(afterSave(draft, steps, 1, {}).recurring).toEqual([]);
    expect(afterSave(draft, steps, 0, {}).recurring).toEqual([tx]);
  });
});

describe("afterSave", () => {
  const draft: Draft = {
    amounts: { a: 10, b: 20 },
    removed: [],
    added: [],
    ops: [],
    recurring: [],
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

describe("filing a plan under a category", () => {
  const tx = {
    id: "draft:1",
    type: "expense",
    categoryId: "cat-a",
    description: "Electricity",
    amount: -25,
    frequency: "monthly",
    dayOfWeek: null,
    dayOfMonth: 1,
    monthOfYear: null,
    startDate: "2026-01-01",
    isActive: true,
  } as RecurringTx;
  /** A category that adds up from its breakdown: a line there is counted. */
  const derived = [alloc("a", 60, [line("rent", 60)])];

  it("adds a line that stands for the plan", () => {
    const draft = filePlan(EMPTY, tx, derived);
    expect(draft.ops).toHaveLength(1);
    expect(draft.ops[0]).toMatchObject({
      kind: "add",
      allocationId: "a",
      parentId: null,
      name: "Electricity",
      amount: 25,
      recurring: { id: "draft:1", frequency: "monthly" },
    });
    // And the cap now includes it: 60 + 25.
    expect(overlay(derived, draft)[0].amount).toBe(85);
  });

  it("leaves a typed cap alone — the roll-up would replace it", () => {
    const typed = [alloc("a", 300)];
    expect(linkable(overlay(typed, EMPTY)[0])).toBe(false);
    expect(filePlan(EMPTY, tx, typed)).toEqual(EMPTY);
    // A cap of zero has nothing to lose, so that one does file.
    expect(filePlan(EMPTY, tx, [alloc("a", 0)]).ops).toHaveLength(1);
  });

  it("files a plan only once, and never files income", () => {
    const once = filePlan(EMPTY, tx, derived);
    expect(filePlan(once, tx, derived)).toEqual(once);
    const income = { ...tx, type: "income" } as RecurringTx;
    expect(filePlan(EMPTY, income, derived)).toEqual(EMPTY);
  });

  it("puts the plan's own call before the line that names it", () => {
    const draft = filePlan({ ...EMPTY, recurring: [tx] }, tx, derived);
    expect(toSteps(draft).map((s) => s.kind)).toEqual(["recurring", "op"]);
  });

  it("rewrites the line's plan id once the plan has been written", () => {
    const draft = filePlan({ ...EMPTY, recurring: [tx] }, tx, derived);
    const steps = toSteps(draft);
    // The plan landed, the line did not: the retry must name the real plan.
    const left = afterSave(draft, steps, 1, { "draft:1": "rec-9" });
    expect(left.recurring).toEqual([]);
    expect(left.ops[0]).toMatchObject({ recurring: { id: "rec-9" } });
  });

  it("frees the plan again when its line is taken back", () => {
    const filed = filePlan(EMPTY, tx, derived);
    const dropped: Draft = {
      ...filed,
      ops: [...filed.ops, { kind: "remove", allocationId: "a", id: filed.ops[0].id }],
    };
    // Not filed any more: the payment goes back to being a row of its own,
    // and `filePlan` may file it somewhere else.
    expect(filedIds(dropped).size).toBe(0);
  });

  it("takes the line back when the plan is dropped, edits and all", () => {
    const filed = filePlan(EMPTY, tx, derived);
    const lineId = filed.ops[0].id;
    const renamed: Draft = {
      ...filed,
      ops: [...filed.ops, { kind: "update", allocationId: "a", id: lineId, name: "x", amount: 25 }],
    };
    // Both go: a rename of a line that will not exist is a 404 waiting to run.
    expect(unfilePlan(renamed, "draft:1").ops).toEqual([]);
  });
});

describe("filing a plan under a category budgeted in this same session", () => {
  const tx = {
    id: "draft:1",
    type: "expense",
    categoryId: "cat-a",
    description: "Electricity",
    amount: -25,
    frequency: "monthly",
    dayOfWeek: null,
    dayOfMonth: 1,
    monthOfYear: null,
    startDate: "2026-01-01",
    isActive: true,
  } as RecurringTx;
  /** No id to hang an op off yet: the line goes in the tree the create carries. */
  const fresh: Draft = {
    ...EMPTY,
    added: [
      {
        key: "new:1",
        categoryId: "cat-a",
        categoryName: "a",
        categoryColor: null,
        amount: 0,
        lines: [],
      },
    ],
    recurring: [tx],
  };

  it("puts the line in the row's own tree, not the op log", () => {
    const draft = filePlan(fresh, tx, []);
    expect(draft.ops).toEqual([]);
    expect(draft.added[0].lines).toMatchObject([
      { name: "Electricity", amount: 25, recurring: { id: "draft:1" } },
    ]);
    expect(filedIds(draft).has("draft:1")).toBe(true);
    expect(unfilePlan(draft, "draft:1").added[0].lines).toEqual([]);
  });

  it("names the plan in the create, after the call that mints its id", () => {
    const steps = toSteps(filePlan(fresh, tx, []));
    expect(steps.map((s) => s.kind)).toEqual(["recurring", "create"]);
    expect(steps[1]).toMatchObject({
      children: [{ name: "Electricity", adoptRecurringId: "draft:1" }],
    });
  });

  it("rewrites the tree's plan id once the plan has been written", () => {
    const draft = filePlan(fresh, tx, []);
    const steps = toSteps(draft);
    // The plan landed, the create did not: the retry must adopt the real one.
    const left = afterSave(draft, steps, 1, { "draft:1": "rec-9" });
    expect(left.recurring).toEqual([]);
    expect(toSteps(left)[0]).toMatchObject({
      children: [{ adoptRecurringId: "rec-9" }],
    });
  });
});
