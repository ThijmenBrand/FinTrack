import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("category-bulk-delete");

const { db } = await import("@/db");
const { categories, recurringTransactions, transactionGroups, transactions } = await import("@/db/schema");
const { eq, and, inArray } = await import("drizzle-orm");

const USER = "user-1";
const OTHER_USER = "user-2";

let seq = 0;

async function insertCategory(id: string, userId = USER, name = id) {
  await db.insert(categories).values({ id, userId, name });
}

async function insertTx(categoryId: string, userId = USER) {
  const id = `tx-${++seq}`;
  await db.insert(transactions).values({
    id,
    userId,
    accountId: "acct-1",
    date: "2026-05-01",
    description: id,
    amount: -10,
    categoryId,
    type: "expense",
  });
  return id;
}

async function insertRecurringTx(categoryId: string, userId = USER) {
  const id = `rec-${++seq}`;
  await db.insert(recurringTransactions).values({
    id,
    userId,
    accountId: "acct-1",
    description: id,
    amount: -50,
    type: "expense",
    frequency: "monthly",
    startDate: "2026-01-01",
    categoryId,
  });
  return id;
}

async function insertPot(categoryId: string, userId = USER) {
  const id = `pot-${++seq}`;
  await db.insert(transactionGroups).values({
    id,
    userId,
    name: id,
    categoryId,
  });
  return id;
}

// Mirrors DELETE /api/categories.
async function bulkDelete(ids: string[], userId = USER) {
  const doomed = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(inArray(categories.id, ids), eq(categories.userId, userId)));

  const doomedIds = doomed.map((cat) => cat.id);

  if (doomedIds.length > 0) {
    for (const cat of doomed) {
      await db
        .update(transactions)
        .set({ categoryId: null, categoryLabel: cat.name, categorySource: null })
        .where(and(eq(transactions.categoryId, cat.id), eq(transactions.userId, userId)));
    }

    await db
      .update(recurringTransactions)
      .set({ categoryId: null })
      .where(
        and(
          inArray(recurringTransactions.categoryId, doomedIds),
          eq(recurringTransactions.userId, userId)
        )
      );

    await db
      .update(transactionGroups)
      .set({ categoryId: null })
      .where(
        and(
          inArray(transactionGroups.categoryId, doomedIds),
          eq(transactionGroups.userId, userId)
        )
      );
  }

  return db
    .delete(categories)
    .where(and(inArray(categories.id, ids), eq(categories.userId, userId)))
    .returning({ id: categories.id });
}

// Every read is user-scoped — the db proxy rejects unscoped tenant queries.
const remaining = (userId = USER) =>
  db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .then((r) => r.map((c) => c.id));

const txCategory = (id: string, userId = USER) =>
  db
    .select({ categoryId: transactions.categoryId, categoryLabel: transactions.categoryLabel })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .then(([r]) => r);

const recCategory = (id: string, userId = USER) =>
  db
    .select({ categoryId: recurringTransactions.categoryId })
    .from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)))
    .then(([r]) => r);

const potCategory = (id: string, userId = USER) =>
  db
    .select({ categoryId: transactionGroups.categoryId })
    .from(transactionGroups)
    .where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)))
    .then(([r]) => r);

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("bulk category delete", () => {
  it("deletes every listed category and keeps its name on the transactions as text", async () => {
    await insertCategory("a", USER, "Groceries");
    await insertCategory("b");
    await insertCategory("c", USER, "Coffee");
    const txA = await insertTx("a");
    const txC = await insertTx("c");

    const deleted = await bulkDelete(["a", "b"]);

    expect(deleted.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect(await remaining()).toEqual(["c"]);
    expect(await txCategory(txA)).toEqual({ categoryId: null, categoryLabel: "Groceries" });
    expect(await txCategory(txC)).toEqual({ categoryId: "c", categoryLabel: null });
  });

  it("labels each transaction with its own category when several are deleted at once", async () => {
    await insertCategory("a", USER, "Groceries");
    await insertCategory("b", USER, "Coffee");
    const txA = await insertTx("a");
    const txB = await insertTx("b");

    await bulkDelete(["a", "b"]);

    expect((await txCategory(txA)).categoryLabel).toBe("Groceries");
    expect((await txCategory(txB)).categoryLabel).toBe("Coffee");
  });

  it("clears categoryId on recurring transactions and pots when category is deleted", async () => {
    await insertCategory("cat-rec", USER, "Subscriptions");
    await insertCategory("cat-pot", USER, "Vacation");
    const recId = await insertRecurringTx("cat-rec");
    const potId = await insertPot("cat-pot");

    const deleted = await bulkDelete(["cat-rec", "cat-pot"]);

    expect(deleted.map((d) => d.id).sort()).toEqual(["cat-pot", "cat-rec"]);
    expect(await remaining()).toEqual([]);
    expect((await recCategory(recId)).categoryId).toBeNull();
    expect((await potCategory(potId)).categoryId).toBeNull();
  });

  it("leaves another user's categories and transactions alone", async () => {
    await insertCategory("mine");
    await insertCategory("theirs", OTHER_USER);
    const theirTx = await insertTx("theirs", OTHER_USER);

    const deleted = await bulkDelete(["mine", "theirs"]);

    expect(deleted.map((d) => d.id)).toEqual(["mine"]);
    expect(await remaining()).toEqual([]);
    expect(await remaining(OTHER_USER)).toEqual(["theirs"]);
    expect((await txCategory(theirTx, OTHER_USER)).categoryId).toBe("theirs");
  });
});
