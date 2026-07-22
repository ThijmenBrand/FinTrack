import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("tx-totals");

const { db } = await import("@/db");
const { transactions, transactionGroups } = await import("@/db/schema");
const { eq, and, sql, isNull, inArray, gte, lte } = await import("drizzle-orm");

const USER = "user-1";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function insertPot() {
  const id = nextId("pot");
  await db.insert(transactionGroups).values({ id, userId: USER, name: `Pot ${seq}` });
  return id;
}

async function insert(
  amount: number,
  opts: { groupId?: string; date?: string; type?: "income" | "expense" } = {}
) {
  await db.insert(transactions).values({
    id: nextId("tx"),
    userId: USER,
    accountId: "acct-1",
    date: opts.date ?? "2026-07-15",
    description: "t",
    amount,
    type: opts.type ?? (amount < 0 ? "expense" : "income"),
    groupId: opts.groupId ?? null,
  });
}

// Mirrors the totals computation in /api/transactions GET: direct (ungrouped)
// sums plus each present pot's FULL net, split by sign.
async function totals(conditions = [eq(transactions.userId, USER)]) {
  const [direct] = await db
    .select({
      income: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
      net: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(...conditions, isNull(transactions.groupId)));

  const potNetRows = await db
    .select({ net: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, USER),
        inArray(
          transactions.groupId,
          db
            .select({ gid: transactions.groupId })
            .from(transactions)
            .where(and(...conditions, sql`${transactions.groupId} IS NOT NULL`))
        )
      )
    )
    .groupBy(transactions.groupId);

  let income = direct?.income || 0;
  let expense = 0;
  let net = direct?.net || 0;
  for (const { net: potNet } of potNetRows) {
    if (potNet > 0) income += potNet;
    else expense += potNet;
    net += potNet;
  }
  return { income, expense, net };
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("transaction totals with pots", () => {
  it("excludes pot members from direct income and counts the pot's net once", async () => {
    await insert(2296.31); // salary
    await insert(200); // direct income
    const pot = await insertPot();
    await insert(57.1, { groupId: pot });
    await insert(144.72, { groupId: pot });
    await insert(-1216.24, { groupId: pot }); // makes the pot net negative

    const { income, expense, net } = await totals();
    // direct income only — the three pot members are not summed in individually
    expect(income).toBeCloseTo(2496.31, 2);
    // pot net (57.10 + 144.72 - 1216.24 = -1014.42) < 0 → expense
    expect(expense).toBeCloseTo(-1014.42, 2);
    expect(net).toBeCloseTo(1481.89, 2);
  });

  it("counts a positive pot net as income", async () => {
    const pot = await insertPot();
    await insert(500, { groupId: pot });
    await insert(-100, { groupId: pot });
    const { income, expense } = await totals();
    expect(income).toBeCloseTo(400, 2);
    expect(expense).toBe(0);
  });

  it("uses the full pot net even when the filter only matches some members", async () => {
    const pot = await insertPot();
    await insert(300, { groupId: pot, date: "2026-07-15" }); // in range
    await insert(-1000, { groupId: pot, date: "2026-01-01" }); // out of range
    const conds = [
      eq(transactions.userId, USER),
      gte(transactions.date, "2026-07-01"),
      lte(transactions.date, "2026-07-31"),
    ];
    const { income, expense } = await totals(conds);
    // pot present via the July member, but its net spans both → -700 → expense
    expect(income).toBe(0);
    expect(expense).toBeCloseTo(-700, 2);
  });
});
