import { describe, it, expect } from "vitest";
import {
  byUrgency,
  fixedCostStatus,
  incomeStatus,
  linkedRecurringIds,
} from "./budget-row";
import type { BudgetSubLine } from "@/types/api";

/** A leaf sub-line, optionally linked to a recurring plan. */
function line(
  id: string,
  opts: { recurringId?: string; children?: BudgetSubLine[] } = {},
): BudgetSubLine {
  return {
    id,
    parentId: null,
    name: id,
    amount: 0,
    children: opts.children ?? [],
    ...(opts.recurringId
      ? {
          recurring: {
            id: opts.recurringId,
            amount: 0,
            frequency: "monthly",
            dayOfWeek: null,
            dayOfMonth: null,
            monthOfYear: null,
            startDate: "2026-01-01",
            isActive: true,
          },
        }
      : {}),
  };
}

describe("byUrgency", () => {
  it("puts exceeded first, then fullest budget, then untouched", () => {
    const rows = [
      { name: "idle", status: "ok", percentage: 0 },
      { name: "half", status: "ok", percentage: 50 },
      { name: "tight", status: "warning", percentage: 90 },
      { name: "over", status: "exceeded", percentage: 846 },
      { name: "over-less", status: "exceeded", percentage: 120 },
    ];
    expect([...rows].sort(byUrgency).map((r) => r.name)).toEqual([
      "over",
      "over-less",
      "tight",
      "half",
      "idle",
    ]);
  });
});

describe("fixedCostStatus", () => {
  it("reads a fixed cost the way an allocation reads", () => {
    expect(fixedCostStatus({ monthlyAmount: 100, spent: 50 }).status).toBe("ok");
    expect(fixedCostStatus({ monthlyAmount: 100, spent: 85 }).status).toBe("warning");
    // Paid to the cent is settled, not exceeded.
    expect(fixedCostStatus({ monthlyAmount: 100, spent: 100 }).status).toBe("warning");
    expect(fixedCostStatus({ monthlyAmount: 100, spent: 100.5 }).status).toBe("exceeded");
  });

  it("owes nothing when every plan in the category is paused", () => {
    expect(fixedCostStatus()).toMatchObject({
      limit: 0,
      spent: 0,
      percentage: 0,
      status: "ok",
    });
  });

  it("sorts in among the allocations", () => {
    const rows = [
      { name: "alloc", status: "ok", percentage: 10 },
      { name: "rent", ...fixedCostStatus({ monthlyAmount: 100, spent: 120 }) },
      { name: "phone", ...fixedCostStatus({ monthlyAmount: 100, spent: 40 }) },
    ];
    expect([...rows].sort(byUrgency).map((r) => r.name)).toEqual([
      "rent",
      "phone",
      "alloc",
    ]);
  });
});

describe("incomeStatus", () => {
  it("warns amber while the money is still outstanding", () => {
    expect(incomeStatus({ expected: 3000, received: 0 })).toMatchObject({
      percentage: 0,
      outstanding: 3000,
      status: "warning",
    });
    expect(incomeStatus({ expected: 3000, received: 1500 })).toMatchObject({
      percentage: 50,
      status: "warning",
    });
  });

  it("turns emerald once the income has landed", () => {
    // Paid to the cent is in, not short — the same slack fixedCostStatus gives.
    expect(incomeStatus({ expected: 3000, received: 3000 })).toMatchObject({
      percentage: 100,
      outstanding: 0,
      status: "received",
    });
    expect(incomeStatus({ expected: 3000, received: 2999.995 }).status).toBe(
      "received",
    );
  });

  it("treats more than planned as good news, never as an overspend", () => {
    const bonus = incomeStatus({ expected: 3000, received: 3500 });
    expect(bonus.status).toBe("received");
    expect(bonus.outstanding).toBe(-500);
    // Unplanned income with no plan behind it is still a windfall, and reads
    // as fully in rather than as an empty bar.
    expect(incomeStatus({ expected: 0, received: 250 })).toMatchObject({
      percentage: 100,
      status: "received",
    });
    // ...but money leaving an income category with nothing planned is not.
    expect(incomeStatus({ expected: 0, received: -40 })).toMatchObject({
      percentage: 0,
      status: "warning",
    });
  });

  it("stays neutral when every plan in the category is paused", () => {
    expect(incomeStatus()).toMatchObject({
      expected: 0,
      received: 0,
      percentage: 0,
      status: "ok",
    });
    expect(incomeStatus({ expected: 0, received: 0 }).status).toBe("ok");
  });
});

describe("linkedRecurringIds", () => {
  it("collects a linked plan at the root", () => {
    const ids = linkedRecurringIds([
      { subLines: [line("rent", { recurringId: "rec-1" }), line("groceries")] },
    ]);
    expect(ids).toEqual(new Set(["rec-1"]));
  });

  it("finds a link nested under an unlinked parent, at any depth", () => {
    const ids = linkedRecurringIds([
      {
        subLines: [
          line("bills", {
            children: [line("phone", { recurringId: "rec-2" })],
          }),
        ],
      },
    ]);
    expect(ids).toEqual(new Set(["rec-2"]));
  });

  it("dedupes and merges across every allocation on screen", () => {
    const ids = linkedRecurringIds([
      { subLines: [line("rent", { recurringId: "rec-1" })] },
      {
        subLines: [
          line("insurance", { recurringId: "rec-3" }),
          line("rent-copy", { recurringId: "rec-1" }),
        ],
      },
    ]);
    expect(ids).toEqual(new Set(["rec-1", "rec-3"]));
  });

  it("returns an empty set when nothing is linked", () => {
    expect(
      linkedRecurringIds([{ subLines: [line("groceries")] }]),
    ).toEqual(new Set());
    expect(linkedRecurringIds([])).toEqual(new Set());
  });
});
