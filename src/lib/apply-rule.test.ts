import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("apply-rule");

const { db } = await import("@/db");
const { applyRuleToTransactions } = await import("./apply-rule");
const { transactions, categories } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const USER = "user-1";
const OTHER_USER = "user-2";

let seq = 0;

async function insertCategory(kind: "spending" | "reserved" = "spending"): Promise<string> {
  const id = `cat-${++seq}`;
  await db.insert(categories).values({ id, userId: USER, name: `Cat ${seq}`, kind });
  return id;
}

async function insertTx(opts: {
  description: string;
  name?: string | null;
  type?: "income" | "expense" | "internal_transfer" | "reimbursement" | "reserved";
  categoryId?: string | null;
  userId?: string;
}): Promise<string> {
  const id = `tx-${++seq}`;
  await db.insert(transactions).values({
    id,
    userId: opts.userId ?? USER,
    accountId: "acct-1",
    date: "2026-05-01",
    name: opts.name ?? null,
    description: opts.description,
    amount: -10,
    categoryId: opts.categoryId ?? null,
    type: opts.type ?? "expense",
  });
  return id;
}

async function getTx(id: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
  return row;
}

describe("applyRuleToTransactions", () => {
  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.reset();
  });

  it("applies a 'contains' rule case-insensitively and marks the source", async () => {
    const catId = await insertCategory();
    const hit = await insertTx({ description: "ALBERT HEIJN 1234 Eindhoven" });
    const miss = await insertTx({ description: "Jumbo Eindhoven" });

    const count = await applyRuleToTransactions({
      pattern: "albert heijn",
      categoryId: catId,
      matchType: "contains",
      userId: USER,
    });

    expect(count).toBe(1);
    const row = await getTx(hit);
    expect(row.categoryId).toBe(catId);
    expect(row.categorySource).toBe("rule");
    expect(row.type).toBe("expense");
    expect((await getTx(miss)).categoryId).toBeNull();
  });

  it("matches 'exact' against the combined name — description target", async () => {
    const catId = await insertCategory();
    const bare = await insertTx({ description: "Spotify" });
    const withName = await insertTx({ name: "Spotify AB", description: "subscription" });
    const partial = await insertTx({ description: "Spotify Premium" });

    expect(
      await applyRuleToTransactions({
        pattern: "spotify",
        categoryId: catId,
        matchType: "exact",
        userId: USER,
      }),
    ).toBe(1);
    expect((await getTx(bare)).categoryId).toBe(catId);
    expect((await getTx(partial)).categoryId).toBeNull();

    // The combined target is "name — description".
    expect(
      await applyRuleToTransactions({
        pattern: "Spotify AB — subscription",
        categoryId: catId,
        matchType: "exact",
        userId: USER,
      }),
    ).toBe(1);
    expect((await getTx(withName)).categoryId).toBe(catId);
  });

  it("matches 'starts_with' on the name when present", async () => {
    const catId = await insertCategory();
    const hit = await insertTx({ name: "PayPal Europe", description: "order 42" });
    const miss = await insertTx({ name: "Via PayPal", description: "order 43" });

    expect(
      await applyRuleToTransactions({
        pattern: "paypal",
        categoryId: catId,
        matchType: "starts_with",
        userId: USER,
      }),
    ).toBe(1);
    expect((await getTx(hit)).categoryId).toBe(catId);
    expect((await getTx(miss)).categoryId).toBeNull();
  });

  it("falls back to 'contains' for an unknown matchType", async () => {
    const catId = await insertCategory();
    const hit = await insertTx({ description: "prefix netflix suffix" });
    expect(
      await applyRuleToTransactions({
        pattern: "netflix",
        categoryId: catId,
        matchType: "bogus" as never,
        userId: USER,
      }),
    ).toBe(1);
    expect((await getTx(hit)).categoryId).toBe(catId);
  });

  it("skips already-categorized rows", async () => {
    const catId = await insertCategory();
    const otherCat = await insertCategory();
    const done = await insertTx({ description: "netflix", categoryId: otherCat });
    expect(
      await applyRuleToTransactions({
        pattern: "netflix",
        categoryId: catId,
        matchType: "contains",
        userId: USER,
      }),
    ).toBe(0);
    expect((await getTx(done)).categoryId).toBe(otherCat);
  });

  it("only touches income/expense rows, never transfers or reserved", async () => {
    const catId = await insertCategory();
    const transfer = await insertTx({ description: "netflix", type: "internal_transfer" });
    const reserved = await insertTx({ description: "netflix", type: "reserved" });
    const income = await insertTx({ description: "netflix refund", type: "income" });

    expect(
      await applyRuleToTransactions({
        pattern: "netflix",
        categoryId: catId,
        matchType: "contains",
        userId: USER,
      }),
    ).toBe(1);
    expect((await getTx(transfer)).categoryId).toBeNull();
    expect((await getTx(reserved)).categoryId).toBeNull();
    expect((await getTx(income)).categoryId).toBe(catId);
  });

  it("is scoped to the given user", async () => {
    const catId = await insertCategory();
    const foreign = await insertTx({ description: "netflix", userId: OTHER_USER });
    expect(
      await applyRuleToTransactions({
        pattern: "netflix",
        categoryId: catId,
        matchType: "contains",
        userId: USER,
      }),
    ).toBe(0);
    expect((await getTx(foreign)).categoryId).toBeNull();
  });

  it("flips matched rows to type='reserved' when the category is reserved-kind (looked up)", async () => {
    const catId = await insertCategory("reserved");
    const hit = await insertTx({ description: "monthly savings", type: "expense" });
    await applyRuleToTransactions({
      pattern: "savings",
      categoryId: catId,
      matchType: "contains",
      userId: USER,
    });
    const row = await getTx(hit);
    expect(row.type).toBe("reserved");
    expect(row.categoryId).toBe(catId);
  });

  it("honours an explicit isReserved=false without a lookup", async () => {
    const catId = await insertCategory("reserved");
    const hit = await insertTx({ description: "monthly savings" });
    await applyRuleToTransactions({
      pattern: "savings",
      categoryId: catId,
      matchType: "contains",
      userId: USER,
      isReserved: false,
    });
    expect((await getTx(hit)).type).toBe("expense");
  });

  it("treats LIKE metacharacters in the pattern as literals", async () => {
    const catId = await insertCategory();
    const literal = await insertTx({ description: "100% cotton _ shop" });
    const other = await insertTx({ description: "100 cotton x shop" });
    expect(
      await applyRuleToTransactions({
        pattern: "100% cotton _",
        categoryId: catId,
        matchType: "contains",
        userId: USER,
      }),
    ).toBe(1);
    expect((await getTx(literal)).categoryId).toBe(catId);
    expect((await getTx(other)).categoryId).toBeNull();
  });

  it("returns the number of rows updated across multiple matches", async () => {
    const catId = await insertCategory();
    await insertTx({ description: "netflix january" });
    await insertTx({ description: "netflix february" });
    await insertTx({ description: "netflix march" });
    expect(
      await applyRuleToTransactions({
        pattern: "netflix",
        categoryId: catId,
        matchType: "contains",
        userId: USER,
      }),
    ).toBe(3);
  });
});
