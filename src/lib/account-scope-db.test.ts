import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("account-scope");

const { getScopeAccountRows, getMonthSummary } = await import(
  "@/app/(app)/_lib/dashboard-queries"
);
const { defaultScopeAccountIds } = await import("@/lib/account-scope");
const { db } = await import("@/db");
const { accounts, transactions } = await import("@/db/schema");

const USER = "user-1";
const TODAY = new Date().toISOString().slice(0, 10);
let seq = 0;

async function tx(
  accountId: string,
  amount: number,
  type: "income" | "expense" | "internal_transfer",
  extra: { id?: string; linkedTransactionId?: string } = {},
) {
  const id = extra.id ?? `tx-${++seq}`;
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId,
    date: TODAY,
    description: "t",
    amount,
    type,
    linkedTransactionId: extra.linkedTransactionId,
  });
  return id;
}

beforeEach(async () => {
  await testDb.reset();
  await db.insert(accounts).values([
    { id: "chk-1", userId: USER, name: "Lopende rekening", type: "checking" },
    { id: "chk-2", userId: USER, name: "Betaalrekening", type: "checking" },
    { id: "sav-1", userId: USER, name: "Spaarrekening", type: "savings" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("dashboard account scope", () => {
  it("defaults to every checking account", async () => {
    expect(defaultScopeAccountIds(await getScopeAccountRows(USER), null)).toEqual(["chk-1", "chk-2"]);
  });

  it("sums both checking accounts and skips savings", async () => {
    await tx("chk-1", 2000, "income");
    await tx("chk-2", 500, "income");
    await tx("sav-1", 90, "income");
    await tx("chk-2", -120, "expense");
    await tx("sav-1", -30, "expense");

    const r = await getMonthSummary(USER, 1, ["chk-1", "chk-2"]);

    expect(r.monthIncome).toBe(2500);
    expect(r.monthExpenses).toBe(120);
  });

  it("still follows a transfer out of a scoped account into the funded account", async () => {
    const out = await tx("chk-1", -200, "internal_transfer");
    await tx("sav-1", 200, "internal_transfer", { linkedTransactionId: out });
    await tx("sav-1", -75, "expense");

    const r = await getMonthSummary(USER, 1, ["chk-1", "chk-2"]);

    expect(r.monthExpenses).toBe(75);
  });
});
