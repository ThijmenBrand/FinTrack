import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("insights-cat-net");

const { db } = await import("@/db");
const { transactions } = await import("@/db/schema");
const { eq, and, sql, inArray } = await import("drizzle-orm");
const { effectiveExpenseAmount } = await import("@/lib/reimbursement-sql");

const USER = "user-1";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function insert(
  amount: number,
  categoryId: string | null,
  type: "income" | "expense" = amount < 0 ? "expense" : "income",
) {
  await db.insert(transactions).values({
    id: nextId("tx"),
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-15",
    description: "t",
    amount,
    type,
    categoryId,
  });
}

// Mirrors `directCategoryExpenses` in /api/insights plus the drop-non-positive
// rule applied to its output.
async function categoryTotals() {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense'
        THEN (${effectiveExpenseAmount()}) ELSE -${transactions.amount} END)`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.type, ["expense", "income"]),
        sql`${transactions.groupId} IS NULL`,
        eq(transactions.userId, USER),
      ),
    )
    .groupBy(transactions.categoryId);
  return rows.filter((r) => r.total > 0);
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("insights category breakdown", () => {
  it("nets income booked to a category off that category's spend", async () => {
    await insert(-1299.79, "woning");
    await insert(200, "woning");
    const [row] = await categoryTotals();
    // The transactions page shows a net of -1.099,79 for this filter; the
    // breakdown must agree instead of reporting the gross 1.299,79.
    expect(row.total).toBeCloseTo(1099.79, 2);
    expect(row.count).toBe(2);
  });

  it("drops income-only categories — salary is not a place money went", async () => {
    await insert(2296.31, "salaris");
    await insert(-50, "woning");
    const rows = await categoryTotals();
    expect(rows.map((r) => r.categoryId)).toEqual(["woning"]);
  });
});
