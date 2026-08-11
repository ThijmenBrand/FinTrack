import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("annual-income");

const { getAnnualIncome } = await import("@/lib/annual-income");
const { db } = await import("@/db");
const { accounts, recurringTransactions, transactions } = await import("@/db/schema");

const USER = "user-1";
const YEAR = 2026;
const IN_JULY = new Date(2026, 6, 10);
let seq = 0;

async function income(date: string, amount: number, accountId = "acct-1") {
  await db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: USER,
    accountId,
    date,
    description: "salary",
    amount,
    type: "income",
  });
}

beforeEach(async () => {
  await testDb.reset();
  await db.insert(accounts).values([
    {
      id: "acct-1",
      userId: USER,
      name: "Joint",
      type: "joint",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: "acct-2",
      userId: USER,
      name: "Private",
      type: "checking",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ]);
});
afterAll(() => testDb.cleanup());

describe("getAnnualIncome", () => {
  it("adds holiday pay to the banked months and projects the rest", async () => {
    for (const month of ["01", "02", "03", "04", "06"]) {
      await income(`2026-${month}-25`, 3000);
    }
    await income("2026-05-25", 6000); // vakantiegeld
    await db.insert(recurringTransactions).values({
      id: "rec-1",
      userId: USER,
      accountId: "acct-1",
      description: "Salary",
      amount: 3000,
      type: "income",
      frequency: "monthly",
      startDate: "2025-01-01",
      isActive: true,
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const result = await getAnnualIncome(USER, YEAR, 1, ["acct-1"], IN_JULY);

    // Jan–Jun really banked 21,000 including the double May.
    expect(result.actual).toBe(21_000);
    // July (in progress, nothing yet) plus Aug–Dec at plan.
    expect(result.projected).toBe(18_000);
    expect(result.total).toBe(39_000);
  });

  it("counts only the plan's accounts", async () => {
    await income("2026-01-25", 3000, "acct-1");
    await income("2026-01-25", 9999, "acct-2");

    const result = await getAnnualIncome(USER, YEAR, 1, ["acct-1"], IN_JULY);
    expect(result.actual).toBe(3000);
  });

  it("spans all accounts when the scope is undefined", async () => {
    await income("2026-01-25", 3000, "acct-1");
    await income("2026-01-25", 1000, "acct-2");

    const result = await getAnnualIncome(USER, YEAR, 1, undefined, IN_JULY);
    expect(result.actual).toBe(4000);
  });

  it("returns nothing for a plan with no accounts", async () => {
    await income("2026-01-25", 3000);
    const result = await getAnnualIncome(USER, YEAR, 1, [], IN_JULY);
    expect(result.total).toBe(0);
  });

  it("leaves out income from a different financial year", async () => {
    await income("2025-12-28", 5000);
    await income("2026-01-05", 3000);

    const result = await getAnnualIncome(USER, YEAR, 1, ["acct-1"], IN_JULY);
    expect(result.actual).toBe(3000);
  });

  it("follows the financial start day at the year boundary", async () => {
    // With startDay 25, 5 Jan 2026 belongs to financial year 2025.
    await income("2026-01-05", 3000);
    await income("2026-01-26", 4000);

    const result = await getAnnualIncome(USER, YEAR, 25, ["acct-1"], IN_JULY);
    expect(result.actual).toBe(4000);
  });
});
