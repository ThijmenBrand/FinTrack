import { describe, it, expect } from "vitest";
import { byUrgency, fixedCostStatus } from "./budget-row";

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
