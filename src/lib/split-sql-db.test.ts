import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("split-sql");

const { db } = await import("@/db");
const { transactions } = await import("@/db/schema");
const { eq, and, sql } = await import("drizzle-orm");
const { excludeSplitParents, excludeSplitChildren } = await import("@/lib/split-sql");

const USER = "user-1";

/**
 * One €900 mortgage split into €600 rente + €300 aflossing, plus one ordinary
 * €100 row. Whichever side of the split an aggregate reads, the account is
 * €1000 lighter — never €1900.
 */
async function seed() {
  const base = {
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-15",
    type: "expense" as const,
    createdAt: new Date().toISOString(),
  };
  await db.insert(transactions).values([
    { ...base, id: "wrapper", description: "Hypotheek", amount: -900, balance: 100, isSplitParent: true },
    { ...base, id: "kid-a", description: "Rente", amount: -600, parentTransactionId: "wrapper" },
    { ...base, id: "kid-b", description: "Aflossing", amount: -300, parentTransactionId: "wrapper" },
    { ...base, id: "plain", description: "Groceries", amount: -100 },
  ]);
}

const total = async (extra?: ReturnType<typeof excludeSplitParents>) => {
  const [row] = await db
    .select({ sum: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
    .from(transactions)
    .where(extra ? and(eq(transactions.userId, USER), extra) : eq(transactions.userId, USER));
  return row.sum;
};

const idsUnder = async (extra: ReturnType<typeof excludeSplitParents>) =>
  (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, USER), extra))
  )
    .map((r) => r.id)
    .sort();

beforeEach(async () => {
  await testDb.reset();
  await seed();
});
afterAll(() => testDb.cleanup());

describe("split-sql filters", () => {
  it("counts every row twice when neither filter is applied — the bug both exist to prevent", () => {
    // Guard rail for the two expectations below: without a filter the split
    // is worth €1900, which is the number that must never reach a screen.
    return expect(total()).resolves.toBe(-1900);
  });

  it("excludeSplitParents keeps the parts and drops the wrapper", async () => {
    // Spend/category/budget aggregates read this side: only the children
    // carry categories once a transaction is split.
    expect(await idsUnder(excludeSplitParents())).toEqual(["kid-a", "kid-b", "plain"]);
    expect(await total(excludeSplitParents())).toBe(-1000);
  });

  it("excludeSplitChildren keeps the wrapper and drops the parts", async () => {
    // Ledger/balance aggregates read this side: the parent is the real bank
    // row and the only one carrying `balance`.
    expect(await idsUnder(excludeSplitChildren())).toEqual(["plain", "wrapper"]);
    expect(await total(excludeSplitChildren())).toBe(-1000);
  });

  it("both sides agree on the total — that is the whole invariant", async () => {
    expect(await total(excludeSplitParents())).toBe(await total(excludeSplitChildren()));
  });

  it("leaves an unsplit ledger untouched", async () => {
    await testDb.reset();
    const now = new Date().toISOString();
    await db.insert(transactions).values([
      { id: "a", userId: USER, accountId: "acct-1", date: "2026-07-15", description: "A", amount: -20, type: "expense", createdAt: now },
      { id: "b", userId: USER, accountId: "acct-1", date: "2026-07-16", description: "B", amount: -30, type: "expense", createdAt: now },
    ]);
    // Neither filter may touch rows that were never part of a split.
    expect(await total(excludeSplitParents())).toBe(-50);
    expect(await total(excludeSplitChildren())).toBe(-50);
  });

  it("keeps a re-split consistent: the parts still add up to the wrapper", async () => {
    // Three parts instead of two, same parent amount.
    await db
      .delete(transactions)
      .where(and(eq(transactions.parentTransactionId, "wrapper"), eq(transactions.userId, USER)));
    const base = {
      userId: USER,
      accountId: "acct-1",
      date: "2026-07-15",
      type: "expense" as const,
      createdAt: new Date().toISOString(),
      parentTransactionId: "wrapper",
    };
    await db.insert(transactions).values([
      { ...base, id: "kid-1", description: "One", amount: -400 },
      { ...base, id: "kid-2", description: "Two", amount: -400 },
      { ...base, id: "kid-3", description: "Three", amount: -100 },
    ]);

    expect(await total(excludeSplitParents())).toBe(-1000);
    expect(await total(excludeSplitChildren())).toBe(-1000);
  });
});
