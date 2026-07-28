import { describe, it, expect } from "vitest";
import { walkBalanceBack } from "./dashboard-queries";

describe("walkBalanceBack", () => {
  it("ends at today's balance and rewinds to the window start", () => {
    // 100 at the window start, +50 on the 5th, -20 on the 12th → 130 today.
    const points = walkBalanceBack(
      130,
      new Map([
        ["2026-01-05", 50],
        ["2026-01-12", -20],
      ]),
      "2026-01-01",
      "2026-01-15",
    );

    expect(points[0]).toEqual({ date: "2026-01-01", value: 100 });
    expect(points.at(-1)).toEqual({ date: "2026-01-15", value: 130 });
    // Weekly samples + today.
    expect(points.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
    expect(points[1].value).toBe(150); // after the +50, before the -20
  });

  it("subtracts future-dated transactions from the starting balance", () => {
    // currentBalance includes a future +40 that must not show up in the window.
    const points = walkBalanceBack(
      140,
      new Map([["2026-02-01", 40]]),
      "2026-01-01",
      "2026-01-08",
    );

    expect(points).toEqual([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-08", value: 100 },
    ]);
  });
});
