/**
 * The daily call budget.
 *
 * The provider's free plan gives twenty calls a day and answers the twenty
 * first with an error, so the only safe design is to refuse locally before
 * spending. What these pin: a reservation is taken before the call, the
 * ceiling is never crossed even under a race, and background work stops short
 * of the cap so a person can still look something up.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "../test-db";

const testDb = await setupTestDb("price-budget");

const { spend, callsUsed, remainingFor, budgetFrom, cleanupBudgetCounters } =
  await import("./budget");

const BUDGET = { cap: 20, reserve: 4 };
const NOW = new Date("2026-11-19T18:00:00Z");

afterAll(() => testDb.cleanup());
beforeEach(() => testDb.reset());

describe("spend", () => {
  it("counts what it reserves", async () => {
    await spend(3, "background", { now: NOW, budget: BUDGET });
    expect(await callsUsed(NOW)).toBe(3);
  });

  it("stops background work at the cap minus the reserve", async () => {
    // 16 is the background ceiling: 20 minus the 4 held back for a person.
    const ok = await spend(16, "background", { now: NOW, budget: BUDGET });
    expect(ok.ok).toBe(true);
    expect(ok.remaining).toBe(0);

    const over = await spend(1, "background", { now: NOW, budget: BUDGET });
    expect(over.ok).toBe(false);
    // Refused cleanly: the refusal must not leave the counter inflated, or
    // the reserve a person is owed would quietly shrink.
    expect(await callsUsed(NOW)).toBe(16);
  });

  it("still lets a person through once background work is out", async () => {
    await spend(16, "background", { now: NOW, budget: BUDGET });
    expect((await spend(1, "interactive", { now: NOW, budget: BUDGET })).ok).toBe(true);
    expect((await spend(3, "interactive", { now: NOW, budget: BUDGET })).ok).toBe(true);
    // ...but not past the plan's own ceiling.
    expect((await spend(1, "interactive", { now: NOW, budget: BUDGET })).ok).toBe(false);
    expect(await callsUsed(NOW)).toBe(20);
  });

  it("refuses the whole request rather than part of it", async () => {
    await spend(15, "background", { now: NOW, budget: BUDGET });
    const result = await spend(5, "background", { now: NOW, budget: BUDGET });
    expect(result.ok).toBe(false);
    // One call was still available; a partial reservation would have taken it
    // and left the caller with a half-priced portfolio.
    expect(await callsUsed(NOW)).toBe(15);
  });

  it("keeps the ceiling under concurrent reservations", async () => {
    // Twenty workers racing for sixteen background calls.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        spend(1, "background", { now: NOW, budget: BUDGET }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(16);
    expect(await callsUsed(NOW)).toBe(16);
  });

  it("starts fresh on the provider's next day", async () => {
    await spend(16, "background", { now: NOW, budget: BUDGET });
    const tomorrow = new Date("2026-11-20T18:00:00Z");
    expect((await spend(1, "background", { now: tomorrow, budget: BUDGET })).ok).toBe(true);
    expect(await callsUsed(tomorrow)).toBe(1);
    // Yesterday's count is untouched, not reused.
    expect(await callsUsed(NOW)).toBe(16);
  });

  it("rolls over at midnight GMT, not local midnight", async () => {
    // 23:30 UTC and 00:30 UTC are different provider days even though they
    // are the same evening in Amsterdam.
    await spend(16, "background", { now: new Date("2026-11-19T23:30:00Z"), budget: BUDGET });
    const after = await spend(1, "background", {
      now: new Date("2026-11-20T00:30:00Z"),
      budget: BUDGET,
    });
    expect(after.ok).toBe(true);
  });
});

describe("remainingFor", () => {
  it("reports each caller's own headroom", async () => {
    await spend(10, "background", { now: NOW, budget: BUDGET });
    expect(await remainingFor("background", { now: NOW, budget: BUDGET })).toBe(6);
    expect(await remainingFor("interactive", { now: NOW, budget: BUDGET })).toBe(10);
  });
});

describe("budgetFrom", () => {
  it("defaults to the free plan", () => {
    expect(budgetFrom({} as unknown as NodeJS.ProcessEnv)).toEqual({ cap: 20, reserve: 4 });
  });

  it("takes the operator's numbers", () => {
    expect(
      budgetFrom({
        EODHD_DAILY_CALL_CAP: "100000",
        EODHD_INTERACTIVE_RESERVE: "100",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ cap: 100000, reserve: 100 });
  });

  it("never lets the reserve starve the refresh entirely", () => {
    const b = budgetFrom({
      EODHD_DAILY_CALL_CAP: "5",
      EODHD_INTERACTIVE_RESERVE: "50",
    } as unknown as NodeJS.ProcessEnv);
    expect(b.reserve).toBe(4);
    expect(b.cap - b.reserve).toBeGreaterThan(0);
  });

  it("ignores nonsense rather than disabling the budget", () => {
    expect(budgetFrom({ EODHD_DAILY_CALL_CAP: "nope" } as unknown as NodeJS.ProcessEnv).cap).toBe(20);
    expect(budgetFrom({ EODHD_DAILY_CALL_CAP: "-5" } as unknown as NodeJS.ProcessEnv).cap).toBe(20);
  });
});

describe("cleanupBudgetCounters", () => {
  it("keeps this week and drops the rest", async () => {
    await spend(1, "background", { now: new Date("2026-11-01T12:00:00Z"), budget: BUDGET });
    await spend(1, "background", { now: new Date("2026-11-19T12:00:00Z"), budget: BUDGET });
    await cleanupBudgetCounters(new Date("2026-11-19T12:00:00Z").getTime());
    expect(await callsUsed(new Date("2026-11-01T12:00:00Z"))).toBe(0);
    expect(await callsUsed(new Date("2026-11-19T12:00:00Z"))).toBe(1);
  });
});
