import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// setupTestDb must configure the env before the lazy `@/db` proxy first
// connects; the proxy only opens on first query, so top-level await here is safe.
const testDb = await setupTestDb("detect-transfers");

const { db } = await import("@/db");
const { detectTransfers } = await import("./detect-transfers");
const { transactions, categories, accounts, accountMembers } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const USER = "user-1";
const OTHER_USER = "user-2";

/** OTHER_USER owns "shared", shared with USER at `role`; USER owns "mine". */
async function shareAccount(role: "editor" | "viewer") {
  await db.insert(accounts).values([
    { id: "shared", userId: OTHER_USER, name: "Joint", type: "joint" },
    { id: "mine", userId: USER, name: "Mine", type: "checking" },
  ]);
  await db.insert(accountMembers).values({
    id: "am-1",
    accountId: "shared",
    userId: USER,
    email: "user1@example.com",
    role,
    acceptedAt: new Date().toISOString(),
  });
}

let seq = 0;

async function insertCategory(name: string, userId = USER): Promise<string> {
  const id = `cat-${++seq}`;
  await db.insert(categories).values({ id, userId, name });
  return id;
}

async function insertTx(opts: {
  accountId: string;
  date: string;
  amount: number;
  type?: "income" | "expense" | "internal_transfer" | "reimbursement";
  userId?: string;
}): Promise<string> {
  const id = `tx-${++seq}`;
  await db.insert(transactions).values({
    id,
    userId: opts.userId ?? USER,
    accountId: opts.accountId,
    date: opts.date,
    description: "test",
    amount: opts.amount,
    type: opts.type ?? (opts.amount < 0 ? "expense" : "income"),
  });
  return id;
}

async function getTx(id: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
  return row;
}

describe("detectTransfers", () => {
  beforeAll(async () => {
    // Force the lazy proxy open so it definitely points at the temp file.
    await db.select().from(categories).limit(1);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("returns zeros when the user has no Internal Transfer category", async () => {
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -100 });
    await insertTx({ accountId: "B", date: "2026-05-01", amount: 100 });
    expect(await detectTransfers(db, USER)).toEqual({
      matchedPairs: 0,
      totalTransactionsUpdated: 0,
    });
  });

  it("links a debit/credit pair across accounts within 2 days", async () => {
    const catId = await insertCategory("Internal Transfer");
    const debit = await insertTx({ accountId: "A", date: "2026-05-01", amount: -100 });
    const credit = await insertTx({ accountId: "B", date: "2026-05-02", amount: 100 });

    expect(await detectTransfers(db, USER)).toEqual({
      matchedPairs: 1,
      totalTransactionsUpdated: 2,
    });

    const d = await getTx(debit);
    const c = await getTx(credit);
    expect(d.type).toBe("internal_transfer");
    expect(c.type).toBe("internal_transfer");
    expect(d.categoryId).toBe(catId);
    expect(c.categoryId).toBe(catId);
    expect(d.linkedTransactionId).toBe(credit);
    expect(c.linkedTransactionId).toBe(debit);
  });

  it("matches at exactly 2 days apart but not at 3", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -50 });
    await insertTx({ accountId: "B", date: "2026-05-03", amount: 50 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(1);

    await testDb.reset();
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -50 });
    await insertTx({ accountId: "B", date: "2026-05-04", amount: 50 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
  });

  it("does not match within the same account", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -100 });
    await insertTx({ accountId: "A", date: "2026-05-01", amount: 100 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
  });

  it("does not match different amounts", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -100 });
    await insertTx({ accountId: "B", date: "2026-05-01", amount: 100.5 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
  });

  it("compares amounts in cents so float noise doesn't break matching", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -16.15 });
    await insertTx({ accountId: "B", date: "2026-05-01", amount: 16.150000000000002 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(1);
  });

  it("skips transactions already typed internal_transfer", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({
      accountId: "A",
      date: "2026-05-01",
      amount: -100,
      type: "internal_transfer",
    });
    await insertTx({ accountId: "B", date: "2026-05-01", amount: 100 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
  });

  it("pairs each credit at most once (two debits, one credit)", async () => {
    await insertCategory("Internal Transfer");
    const d1 = await insertTx({ accountId: "A", date: "2026-05-01", amount: -75 });
    const d2 = await insertTx({ accountId: "A", date: "2026-05-01", amount: -75 });
    await insertTx({ accountId: "B", date: "2026-05-01", amount: 75 });

    expect(await detectTransfers(db, USER)).toEqual({
      matchedPairs: 1,
      totalTransactionsUpdated: 2,
    });
    const types = [(await getTx(d1)).type, (await getTx(d2)).type].sort();
    expect(types).toEqual(["expense", "internal_transfer"]);
  });

  it("only considers the given user's transactions", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -100 });
    const otherCredit = await insertTx({
      accountId: "B",
      date: "2026-05-01",
      amount: 100,
      userId: OTHER_USER,
    });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
    expect((await getTx(otherCredit)).type).toBe("income");
  });

  it("pairs a private account with an editor-shared one, each side keeping its own transfer category", async () => {
    await shareAccount("editor");
    const myCat = await insertCategory("Internal Transfer");
    const ownerCat = await insertCategory("Internal Transfer", OTHER_USER);
    const debit = await insertTx({ accountId: "mine", date: "2026-05-01", amount: -100 });
    const credit = await insertTx({
      accountId: "shared",
      date: "2026-05-02",
      amount: 100,
      userId: OTHER_USER,
    });

    expect((await detectTransfers(db, USER)).matchedPairs).toBe(1);

    const d = await getTx(debit);
    const c = await getTx(credit);
    expect([d.type, c.type]).toEqual(["internal_transfer", "internal_transfer"]);
    expect(d.categoryId).toBe(myCat);
    expect(c.categoryId).toBe(ownerCat);
    expect(d.linkedTransactionId).toBe(credit);
    expect(c.linkedTransactionId).toBe(debit);
  });

  it("leaves the pair alone when the other side has no transfer category", async () => {
    await shareAccount("editor");
    await insertCategory("Internal Transfer");
    const debit = await insertTx({ accountId: "mine", date: "2026-05-01", amount: -100 });
    await insertTx({ accountId: "shared", date: "2026-05-01", amount: 100, userId: OTHER_USER });

    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
    expect((await getTx(debit)).type).toBe("expense");
  });

  it("ignores viewer-shared accounts — half a pair is worse than none", async () => {
    await shareAccount("viewer");
    await insertCategory("Internal Transfer");
    await insertCategory("Internal Transfer", OTHER_USER);
    const debit = await insertTx({ accountId: "mine", date: "2026-05-01", amount: -100 });
    await insertTx({ accountId: "shared", date: "2026-05-01", amount: 100, userId: OTHER_USER });

    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
    expect((await getTx(debit)).type).toBe("expense");
  });

  it("is idempotent — a second run finds nothing new", async () => {
    await insertCategory("Internal Transfer");
    await insertTx({ accountId: "A", date: "2026-05-01", amount: -100 });
    await insertTx({ accountId: "B", date: "2026-05-01", amount: 100 });
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(1);
    expect((await detectTransfers(db, USER)).matchedPairs).toBe(0);
  });
});
