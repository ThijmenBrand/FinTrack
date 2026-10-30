import { describe, expect, it } from "vitest";
import {
  MAX_POT_BUDGET_LINES,
  MAX_POT_LINE_CATEGORIES,
  POT_BUDGET_ERROR,
  attributePotSpend,
  buildLineTree,
  categoryLineMap,
  potPhase,
  spendStatus,
  treeToInput,
  validatePotBudget,
  type PotLineNode,
  type StoredPotLine,
} from "./pot-budget";

const line = (name: string, amount: number, categoryIds: string[] = [], children: unknown[] = []) => ({
  name,
  amount,
  categoryIds,
  children,
});

const ok = (raw: unknown, hasTargetDate = false) => {
  const r = validatePotBudget(raw, { hasTargetDate });
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
};
const err = (raw: unknown, hasTargetDate = false) => {
  const r = validatePotBudget(raw, { hasTargetDate });
  if (r.ok) throw new Error("expected a failure");
  return r;
};

describe("validatePotBudget", () => {
  it("accepts a total without lines, and no budget at all", () => {
    expect(ok({ total: 2000, lines: [] })).toEqual({ total: 2000, lines: [] });
    expect(ok({ total: null, lines: [] })).toEqual({ total: null, lines: [] });
    expect(ok({})).toEqual({ total: null, lines: [] });
  });

  it("accepts lines that sum to the total, normalising names and cents", () => {
    const v = ok({ total: 1000, lines: [line("  Flights ", 400.004), line("Hotel", 599.996)] });
    expect(v.lines.map((l) => [l.name, l.amount])).toEqual([
      ["Flights", 400],
      ["Hotel", 600],
    ]);
  });

  it("compares in cents, so float noise doesn't block a matching budget", () => {
    expect(ok({ total: 0.3, lines: [line("A", 0.1), line("B", 0.2)] }).total).toBe(0.3);
  });

  it("rejects lines that don't add up to the total", () => {
    expect(err({ total: 1000, lines: [line("A", 400), line("B", 500)] }).error).toBe(
      POT_BUDGET_ERROR.sumMismatch,
    );
    expect(err({ total: 1000, lines: [line("A", 1200)] }).error).toBe(POT_BUDGET_ERROR.sumMismatch);
  });

  it("derives a parent's amount from its children and ignores what was sent", () => {
    const v = ok({
      total: 700,
      lines: [line("Transport", 999, [], [line("Flights", 500), line("Car", 200)])],
    });
    expect(v.lines[0].amount).toBe(700);
    expect(v.lines[0].children.map((c) => c.amount)).toEqual([500, 200]);
  });

  it("checks the sum against the children, not the parent's claimed amount", () => {
    expect(
      err({ total: 999, lines: [line("Transport", 999, [], [line("Flights", 500)])] }).error,
    ).toBe(POT_BUDGET_ERROR.sumMismatch);
  });

  it("rejects sub-lines of sub-lines", () => {
    const deep = line("A", 0, [], [line("B", 0, [], [line("C", 10)])]);
    expect(err({ total: 10, lines: [deep] }).error).toBe(POT_BUDGET_ERROR.tooDeep);
  });

  it("requires a total once there are lines, and for a dated pot", () => {
    expect(err({ total: null, lines: [line("A", 10)] }).error).toBe(POT_BUDGET_ERROR.totalRequired);
    expect(err({ total: null, lines: [] }, true).error).toBe(POT_BUDGET_ERROR.totalRequiredByDate);
    expect(ok({ total: 10, lines: [] }, true).total).toBe(10);
  });

  it.each([0, -5, Number.NaN, Infinity, "100", 0.001])("rejects total %s", (total) => {
    expect(err({ total, lines: [] }).error).toBe(POT_BUDGET_ERROR.totalInvalid);
  });

  it.each([-1, Number.NaN, "5", undefined])("rejects leaf amount %s", (amount) => {
    expect(err({ total: 10, lines: [{ name: "A", amount, categoryIds: [] }] }).error).toBe(
      POT_BUDGET_ERROR.lineAmount,
    );
  });

  it("allows a zero line, e.g. a line that only tracks a category", () => {
    expect(ok({ total: 10, lines: [line("A", 10), line("Souvenirs", 0, ["c1"])] }).lines).toHaveLength(2);
  });

  it.each(["", "   ", "x".repeat(51), 42])("rejects line name %j", (name) => {
    expect(err({ total: 10, lines: [{ name, amount: 10, categoryIds: [] }] }).error).toBe(
      POT_BUDGET_ERROR.lineName,
    );
  });

  it("rejects a category used twice: across lines, in one line, or parent and child", () => {
    expect(
      err({ total: 20, lines: [line("A", 10, ["c1"]), line("B", 10, ["c1"])] }),
    ).toEqual({ ok: false, error: POT_BUDGET_ERROR.duplicateCategory, categoryId: "c1" });
    expect(err({ total: 10, lines: [line("A", 10, ["c1", "c1"])] }).error).toBe(
      POT_BUDGET_ERROR.duplicateCategory,
    );
    expect(
      err({ total: 10, lines: [line("A", 0, ["c1"], [line("B", 10, ["c1"])])] }).error,
    ).toBe(POT_BUDGET_ERROR.duplicateCategory);
  });

  it("caps lines and categories per line", () => {
    const many = Array.from({ length: MAX_POT_BUDGET_LINES + 1 }, (_, i) => line(`L${i}`, 1));
    expect(err({ total: many.length, lines: many }).error).toBe(POT_BUDGET_ERROR.tooMany);
    const cats = Array.from({ length: MAX_POT_LINE_CATEGORIES + 1 }, (_, i) => `c${i}`);
    expect(err({ total: 10, lines: [line("A", 10, cats)] }).error).toBe(
      POT_BUDGET_ERROR.tooManyCategories,
    );
  });

  it("rejects malformed shapes", () => {
    expect(err(null).error).toBe(POT_BUDGET_ERROR.invalid);
    expect(err([]).error).toBe(POT_BUDGET_ERROR.invalid);
    expect(err({ total: 10, lines: "nope" }).error).toBe(POT_BUDGET_ERROR.invalid);
    expect(err({ total: 10, lines: [line("A", 10, [5 as unknown as string])] }).error).toBe(
      POT_BUDGET_ERROR.invalid,
    );
    expect(err({ total: 10, lines: [{ ...line("A", 10), children: "x" }] }).error).toBe(
      POT_BUDGET_ERROR.invalid,
    );
  });
});

describe("potPhase", () => {
  it("is none without a total", () => {
    expect(potPhase({ targetAmount: null, targetDate: null }, "2026-07-01")).toBe("none");
  });
  it("saves until the target date and spends from that day on", () => {
    const pot = { targetAmount: 2000, targetDate: "2026-07-12" };
    expect(potPhase(pot, "2026-07-11")).toBe("saving");
    expect(potPhase(pot, "2026-07-12")).toBe("spending");
    expect(potPhase(pot, "2026-08-01")).toBe("spending");
  });
  it("is always spending for an undated budget", () => {
    expect(potPhase({ targetAmount: 500, targetDate: null }, "2026-01-01")).toBe("spending");
  });
});

describe("spendStatus", () => {
  it.each([
    [79.9, 100, "ok"],
    [80, 100, "warning"],
    [100, 100, "warning"],
    [100.004, 100, "warning"],
    [100.01, 100, "exceeded"],
    [0, 0, "ok"],
    [1, 0, "exceeded"],
  ] as const)("spent %s of %s is %s", (spent, planned, status) => {
    expect(spendStatus(spent, planned)).toBe(status);
  });
});

const stored = (
  id: string,
  parentId: string | null,
  amount: number,
  categoryIds: string[] = [],
  sortOrder = 0,
): StoredPotLine => ({ id, parentId, name: id, amount, sortOrder, categoryIds });

describe("buildLineTree", () => {
  it("nests sub-lines in sort order and re-derives parent amounts", () => {
    const tree = buildLineTree([
      stored("food", null, 1, ["groceries"], 1),
      stored("transport", null, 999, [], 0),
      stored("car", "transport", 200, [], 1),
      stored("flights", "transport", 500, [], 0),
    ]);
    expect(tree.map((l) => l.id)).toEqual(["transport", "food"]);
    expect(tree[0].children.map((c) => c.id)).toEqual(["flights", "car"]);
    expect(tree[0].amount).toBe(700);
    expect(tree[1].amount).toBe(1);
  });

  it("promotes an orphaned row to the top level", () => {
    expect(buildLineTree([stored("x", "gone", 5)]).map((l) => l.id)).toEqual(["x"]);
  });

  it("round-trips through treeToInput", () => {
    const tree = buildLineTree([stored("a", null, 0, ["c1"]), stored("b", "a", 10, ["c2"])]);
    expect(treeToInput(10, tree)).toEqual({
      total: 10,
      lines: [
        {
          name: "a",
          amount: 10,
          categoryIds: ["c1"],
          children: [{ name: "b", amount: 10, categoryIds: ["c2"], children: [] }],
        },
      ],
    });
  });
});

describe("categoryLineMap", () => {
  it("maps parent and sub-line categories to their own line", () => {
    const tree = buildLineTree([stored("food", null, 0, ["snacks"]), stored("dining", "food", 10, ["restaurants"])]);
    const map = categoryLineMap(tree);
    expect(map.get("snacks")).toEqual({ lineId: "food", lineName: "food", parentName: null });
    expect(map.get("restaurants")).toEqual({ lineId: "dining", lineName: "dining", parentName: "food" });
  });
});

describe("attributePotSpend", () => {
  // Vacation: total 2000 = Flights 400 + Hotel 800 + Food 800 (Dining 500 + Groceries 300).
  const tree: PotLineNode[] = buildLineTree([
    stored("flights", null, 400, ["c-flights"], 0),
    stored("hotel", null, 800, ["c-hotel"], 1),
    stored("food", null, 0, ["c-snacks"], 2),
    stored("dining", "food", 500, ["c-restaurants"], 0),
    stored("groceries", "food", 300, ["c-groceries"], 1),
  ]);

  it("lands each category's net on its line and rolls sub-lines into the parent", () => {
    const view = attributePotSpend(2000, tree, [
      { categoryId: "c-flights", net: -380 },
      { categoryId: "c-hotel", net: -900 },
      { categoryId: "c-restaurants", net: -420 },
      { categoryId: "c-groceries", net: -100 },
      { categoryId: "c-snacks", net: -30 },
    ]);
    const [flights, hotel, food] = view.lines;
    expect([flights.spent, flights.status]).toEqual([380, "warning"]);
    expect([hotel.spent, hotel.remaining, hotel.status]).toEqual([900, -100, "exceeded"]);
    expect(food.planned).toBe(800);
    expect(food.spent).toBe(550); // 420 + 100 + 30 own
    expect(food.children.map((c) => c.spent)).toEqual([420, 100]);
    expect(view.spent).toBe(1830);
    expect(view.remaining).toBe(170);
    expect(view.pct).toBeCloseTo(91.5);
    expect(view.status).toBe("warning");
    expect(view.unplanned).toEqual({ spent: 0, groups: [] });
    expect(view.worstLine).toEqual({ id: "hotel", name: "hotel", parentName: null, overBy: 100 });
  });

  it("nets refunds against their line and floors a line at zero", () => {
    const view = attributePotSpend(2000, tree, [
      { categoryId: "c-hotel", net: -800 },
      { categoryId: "c-hotel", net: 200 },
      { categoryId: "c-flights", net: 50 },
    ]);
    expect(view.lines[1].spent).toBe(600);
    expect(view.lines[0].spent).toBe(0);
    // The pot total nets everything: 800 − 200 − 50.
    expect(view.spent).toBe(550);
  });

  it("puts unclaimed and uncategorized spend in Unplanned, biggest first", () => {
    const view = attributePotSpend(2000, tree, [
      { categoryId: "c-souvenirs", net: -45 },
      { categoryId: null, net: -120 },
      { categoryId: "c-tickets", net: 20 },
      { categoryId: "c-zero", net: 0 },
    ]);
    expect(view.unplanned.groups).toEqual([
      { categoryId: null, spent: 120 },
      { categoryId: "c-souvenirs", spent: 45 },
      { categoryId: "c-tickets", spent: -20 },
    ]);
    expect(view.unplanned.spent).toBe(145);
    expect(view.spent).toBe(145);
  });

  it("treats everything as Unplanned when the budget has no lines", () => {
    const view = attributePotSpend(500, [], [{ categoryId: "c1", net: -600 }]);
    expect(view.lines).toEqual([]);
    expect(view.unplanned.spent).toBe(600);
    expect([view.spent, view.remaining, view.status]).toEqual([600, -100, "exceeded"]);
  });

  it("reports spend without a total but no status against it", () => {
    const view = attributePotSpend(null, [], [{ categoryId: "c1", net: -60 }]);
    expect([view.total, view.remaining, view.pct, view.status]).toEqual([null, null, 0, "ok"]);
    expect(view.spent).toBe(60);
  });

  it("prefers the sub-line when it and its parent are over by the same amount", () => {
    const view = attributePotSpend(2000, tree, [{ categoryId: "c-restaurants", net: -600 }]);
    // Dining is 100 over; Food (800) is not over at 600.
    expect(view.worstLine).toEqual({ id: "dining", name: "dining", parentName: "food", overBy: 100 });

    const tie = attributePotSpend(2000, tree, [
      { categoryId: "c-restaurants", net: -600 },
      { categoryId: "c-groceries", net: -300 },
    ]);
    // Food is 900/800 → 100 over, same as Dining: the sub-line wins.
    expect(tie.worstLine?.id).toBe("dining");
  });

  it("has no worst line when nothing is over", () => {
    expect(attributePotSpend(2000, tree, [{ categoryId: "c-hotel", net: -800 }]).worstLine).toBeNull();
  });
});
