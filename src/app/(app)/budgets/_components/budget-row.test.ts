import { describe, it, expect } from "vitest";
import { byUrgency } from "./budget-row";

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
