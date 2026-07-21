import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("pot-spent");

const { db } = await import("@/db");
const { transactions, transactionGroups } = await import("@/db/schema");
const { eq, and, sql } = await import("drizzle-orm");
const { potSpentAmount } = await import("@/lib/reimbursement-sql");

const USER = "user-1";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function insertPot() {
  const id = nextId("pot");
  await db.insert(transactionGroups).values({ id, userId: USER, name: `Pot ${seq}` });
  return id;
}

async function insertMember(groupId: string, amount: number, type: "expense" | "income" = amount < 0 ? "expense" : "income") {
  await db.insert(transactions).values({
    id: nextId("tx"),
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-15",
    description: "t",
    amount,
    type,
    groupId,
  });
}

// Mirrors the pot-spend query in /api/budgets, /api/insights, etc.
function potTotals() {
  return db
    .select({
      groupId: transactionGroups.id,
      potTotal: sql<number>`${potSpentAmount()}`,
    })
    .from(transactionGroups)
    .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
    .where(and(eq(transactions.userId, USER)))
    .groupBy(transactionGroups.id);
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("potSpentAmount", () => {
  it("reports net spending when expenses exceed income", async () => {
    const pot = await insertPot();
    await insertMember(pot, -900);
    await insertMember(pot, 300);
    const [row] = await potTotals();
    expect(row.potTotal).toBe(600);
  });

  it("reports 0 (not abs of net) when income exceeds expenses", async () => {
    const pot = await insertPot();
    await insertMember(pot, -100);
    await insertMember(pot, 500);
    const [row] = await potTotals();
    expect(row.potTotal).toBe(0);
  });
});
