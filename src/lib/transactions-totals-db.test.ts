import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("tx-totals");

const { db } = await import("@/db");
const { transactions, transactionGroups, reimbursementLinks } = await import("@/db/schema");
const { eq, and, sql, isNull, gte, lte } = await import("drizzle-orm");
const { effectiveExpenseAmount } = await import("@/lib/reimbursement-sql");

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
  opts: {
    groupId?: string;
    date?: string;
    type?: "income" | "expense" | "reimbursement" | "internal_transfer";
  } = {}
) {
  const id = nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: "acct-1",
    date: opts.date ?? "2026-07-15",
    description: "t",
    amount,
    type: opts.type ?? (amount < 0 ? "expense" : "income"),
    groupId: opts.groupId ?? null,
  });
  return id;
}

/** Link a reimbursement transaction to the expenses it pays back. */
async function reimburse(amount: number, ...expenseIds: string[]) {
  const id = await insert(amount, { type: "reimbursement" });
  await db
    .insert(reimbursementLinks)
    .values(expenseIds.map((expenseId) => ({ reimbursementId: id, expenseId })));
}

// Mirrors the totals computation in /api/transactions GET: direct (ungrouped)
// sums plus each pot's net over the filtered members, split by sign.
async function totals(conditions = [eq(transactions.userId, USER)]) {
  const [direct] = await db
    .select({
      income: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
      expense: sql<number>`-COALESCE(SUM(CASE WHEN ${transactions.type} = 'expense' THEN (
        ${effectiveExpenseAmount()}
      ) ELSE 0 END), 0)`,
      transfers: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'internal_transfer' THEN ${transactions.amount} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(and(...conditions, isNull(transactions.groupId)));

  const potNetRows = await db
    .select({ net: sql<number>`COALESCE(SUM(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        ...conditions,
        sql`${transactions.groupId} IS NOT NULL`,
        sql`${transactions.type} != 'internal_transfer'`
      )
    )
    .groupBy(transactions.groupId);

  let income = direct?.income || 0;
  let expense = direct?.expense || 0;
  for (const { net: potNet } of potNetRows) {
    if (potNet > 0) income += potNet;
    else expense += potNet;
  }
  return { income, expense, net: income + expense + (direct?.transfers || 0) };
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

  it("scopes a pot's net to the filtered members, not its whole lifetime", async () => {
    const pot = await insertPot();
    await insert(300, { groupId: pot, date: "2026-07-15" }); // in range
    await insert(-1000, { groupId: pot, date: "2026-01-01" }); // out of range
    const conds = [
      eq(transactions.userId, USER),
      gte(transactions.date, "2026-07-01"),
      lte(transactions.date, "2026-07-31"),
    ];
    const { income, expense } = await totals(conds);
    // only the July member counts → +300 → income. Counting January too would
    // report -700 of expense in a month that had none.
    expect(income).toBeCloseTo(300, 2);
    expect(expense).toBe(0);
  });

  it("ignores internal transfers into a pot — funding it is not spending it", async () => {
    const pot = await insertPot();
    await insert(500, { groupId: pot, type: "internal_transfer" });
    await insert(-120, { groupId: pot });
    const { income, expense } = await totals();
    expect(income).toBe(0); // the 500 top-up must not read as income
    expect(expense).toBeCloseTo(-120, 2);
  });
});

describe("transaction totals with reimbursements", () => {
  it("nets a reimbursement off the expense it repays, not on top as income", async () => {
    const tx = await insert(-18.77);
    await reimburse(18.77, tx);
    const { income, expense, net } = await totals();
    expect(expense).toBe(0); // row shows € 0,00 — the card must agree
    expect(income).toBe(0); // the reimbursement is not income
    expect(net).toBe(0);
  });

  it("subtracts a partial reimbursement", async () => {
    const tx = await insert(-75);
    await reimburse(37.5, tx);
    const { expense } = await totals();
    expect(expense).toBeCloseTo(-37.5, 2);
  });

  it("splits a reimbursement pro-rata across the expenses it covers", async () => {
    const a = await insert(-60);
    const b = await insert(-40);
    await reimburse(50, a, b); // 25 off each, not 50 off both
    const { expense } = await totals();
    expect(expense).toBeCloseTo(-50, 2); // (60-25) + (40-25); double-subtracting gives 0
  });

  it("floors an over-reimbursed expense at zero", async () => {
    const tx = await insert(-20);
    await reimburse(30, tx);
    const { expense } = await totals();
    expect(expense).toBe(0);
  });
});
