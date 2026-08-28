import { describe, expect, it } from "vitest";
import { sectionOf, visibleRows } from "./recurring-list";
import type { RecurringTx } from "@/types/api";

const plan = (p: Partial<RecurringTx>): RecurringTx =>
  ({
    id: p.description,
    description: "x",
    amount: 10,
    type: "expense",
    frequency: "monthly",
    isActive: true,
    nextOccurrence: "2026-09-01",
    categoryName: null,
    accountName: null,
    ...p,
  }) as RecurringTx;

const rent = plan({ description: "Rent", amount: 899, nextOccurrence: "2026-09-02" });
const hbo = plan({ description: "HBO Max", amount: 4.5, nextOccurrence: "2026-09-01" });
const old = plan({ description: "Gym", amount: 30, isActive: false, nextOccurrence: null });
const yearly = plan({
  description: "Insurance",
  amount: 120,
  frequency: "yearly",
  nextOccurrence: "2026-12-01",
  categoryName: "Gezondheid",
});
const all = [rent, hbo, old, yearly];

const names = (rows: RecurringTx[]) => rows.map((r) => r.description);

describe("visibleRows", () => {
  it("sorts by next date with paused plans last", () => {
    expect(names(visibleRows(all, "", "all", "next"))).toEqual([
      "HBO Max",
      "Rent",
      "Insurance",
      "Gym",
    ]);
  });

  it("sorts by monthly-equivalent amount, not raw amount", () => {
    // €120/yr is €10/mo, so it ranks above HBO Max's €4.50 but below Rent.
    expect(names(visibleRows(all, "", "all", "amount"))).toEqual([
      "Rent",
      "Insurance",
      "HBO Max",
      "Gym",
    ]);
  });

  it("sorts by name", () => {
    expect(names(visibleRows(all, "", "all", "name"))).toEqual([
      "HBO Max",
      "Insurance",
      "Rent",
      "Gym",
    ]);
  });

  it("filters on status", () => {
    expect(names(visibleRows(all, "", "paused", "name"))).toEqual(["Gym"]);
    expect(visibleRows(all, "", "active", "name")).toHaveLength(3);
  });

  it("searches description and category, case-insensitively", () => {
    expect(names(visibleRows(all, "hbo", "all", "name"))).toEqual(["HBO Max"]);
    expect(names(visibleRows(all, "gezond", "all", "name"))).toEqual(["Insurance"]);
    expect(visibleRows(all, "nope", "all", "name")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const input = [...all];
    visibleRows(input, "", "all", "name");
    expect(input).toEqual(all);
  });
});

describe("sectionOf", () => {
  it("keeps a transfer-category plan out of both income and expenses", () => {
    // The move to the joint account and the deposit landing there are one
    // move: counted as an expense and an income it inflates both totals.
    const out = plan({ description: "To joint", categoryKind: "transfer" });
    const back = plan({ description: "Joint deposit", type: "income", categoryKind: "transfer" });
    expect(sectionOf(out)).toBe("transfer");
    expect(sectionOf(back)).toBe("transfer");
    expect(sectionOf(rent)).toBe("expense");
    expect(sectionOf(plan({ description: "Salary", type: "income" }))).toBe("income");
  });
});
