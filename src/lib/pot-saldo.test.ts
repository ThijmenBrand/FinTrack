import { describe, expect, it } from "vitest";
import { potGraph } from "./pot-saldo";

const base = {
  createdAt: "2026-01-05T10:00:00.000Z",
  targetAmount: 1000,
  fundedAmount: 300,
  allocations: [
    { date: "2026-02-01T08:00:00.000Z", delta: 200, fundedAfter: 200 },
    { date: "2026-03-01T08:00:00.000Z", delta: 100, fundedAfter: 300 },
  ],
  transactions: [
    { date: "2026-07-14", amount: -400, type: "expense" as const },
    { date: "2026-07-12", amount: 500, type: "internal_transfer" as const },
    { date: "2026-07-13", amount: -250, type: "expense" as const },
    { date: "2026-07-20", amount: 50, type: "income" as const },
  ],
  todayIso: "2026-04-01",
};

describe("potGraph", () => {
  it("plots what was set aside while saving, up to today, with the pace line", () => {
    const g = potGraph({
      ...base,
      phase: "saving",
      paydaySchedule: [{ date: "2026-02-25", expectedFunded: 500 }],
    });
    expect(g.series).toEqual([
      { date: "2026-01-05", value: 0 },
      { date: "2026-02-01", value: 200 },
      { date: "2026-03-01", value: 300 },
      { date: "2026-04-01", value: 300 },
    ]);
    expect(g.expected).toEqual([
      { date: "2026-01-05", value: 0 },
      { date: "2026-02-25", value: 500 },
    ]);
    expect(g.target).toBe(1000);
  });

  it("plots cumulative spend against the total once spending, skipping transfers", () => {
    const g = potGraph({ ...base, phase: "spending" });
    expect(g.series).toEqual([
      { date: "2026-07-13", value: 250 },
      { date: "2026-07-14", value: 650 },
      { date: "2026-07-20", value: 600 },
    ]);
    expect(g.target).toBe(1000);
    expect(g.expected).toBeUndefined();
  });

  it("plots the running net for a pot without a budget", () => {
    const g = potGraph({ ...base, phase: "none", targetAmount: null });
    expect(g.series.map((p) => p.value)).toEqual([500, 250, -150, -100]);
    expect(g.target).toBeNull();
  });
});
