import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("tx-exclude");

const { db } = await import("@/db");
const { transactions, categories } = await import("@/db/schema");
const { and, eq, or, isNull, notInArray } = await import("drizzle-orm");

const USER = "user-1";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function insertCategory() {
  const id = nextId("cat");
  await db.insert(categories).values({ id, userId: USER, name: `Cat ${seq}` });
  return id;
}

async function insertTx(opts: { categoryId?: string | null; type?: "expense" | "internal_transfer" }) {
  const id = nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-01",
    description: "t",
    amount: -10,
    type: opts.type ?? "expense",
    categoryId: opts.categoryId ?? null,
  });
  return id;
}

// Mirrors the exclusion conditions in GET /api/transactions.
function run(opts: { excludeCategoryIds?: string[]; excludeTypes?: string[] }) {
  const conditions = [eq(transactions.userId, USER)];
  if (opts.excludeCategoryIds?.length) {
    conditions.push(
      or(isNull(transactions.categoryId), notInArray(transactions.categoryId, opts.excludeCategoryIds))!,
    );
  }
  if (opts.excludeTypes?.length) {
    conditions.push(notInArray(transactions.type, opts.excludeTypes as ("expense" | "internal_transfer")[]));
  }
  return db.select({ id: transactions.id }).from(transactions).where(and(...conditions));
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("transaction exclusion filters", () => {
  it("excluding a category keeps uncategorized rows visible", async () => {
    const groceries = await insertCategory();
    const excluded = await insertTx({ categoryId: groceries });
    const uncategorized = await insertTx({ categoryId: null });

    const rows = await run({ excludeCategoryIds: [groceries] });
    const ids = rows.map((r) => r.id);

    expect(ids).not.toContain(excluded);
    expect(ids).toContain(uncategorized); // NULL category must not be filtered out
  });

  it("excluding internal_transfer hides those rows only", async () => {
    const transfer = await insertTx({ type: "internal_transfer" });
    const expense = await insertTx({ type: "expense" });

    const rows = await run({ excludeTypes: ["internal_transfer"] });
    const ids = rows.map((r) => r.id);

    expect(ids).not.toContain(transfer);
    expect(ids).toContain(expense);
  });
});
