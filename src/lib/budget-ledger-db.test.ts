import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("budget-ledger");

const {
  buildLedgerYear,
  clearLedger,
  getYearSpendByCategoryMonth,
  planStartMonthIndex,
} = await import("@/lib/budget-ledger-db");
const { financialSlotOf } = await import("@/lib/financial-year");
const { db } = await import("@/db");
const {
  accounts,
  budgetMonthTargets,
  budgetPlans,
  budgets,
  categories,
  reimbursementLinks,
  transactionGroups,
  transactions,
} = await import("@/db/schema");

const USER = "user-1";
const PLAN = "plan-1";
const OTHER_PLAN = "plan-2";
const YEAR = 2026;
// A date after the whole of 2026, so every month of the year counts as closed
// unless a test says otherwise.
const AFTER_YEAR = new Date(2027, 5, 1);
let seq = 0;

async function expense(
  date: string,
  amount: number,
  opts: { categoryId?: string; groupId?: string; accountId?: string; id?: string } = {},
) {
  const id = opts.id ?? `tx-${++seq}`;
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: opts.accountId ?? "acct-1",
    date,
    description: "t",
    amount: -Math.abs(amount),
    type: "expense",
    categoryId: opts.categoryId ?? "c-food",
    groupId: opts.groupId,
  });
  return id;
}

async function allocate(categoryId: string, amount: number, createdAt = "2025-01-01T00:00:00.000Z") {
  await db.insert(budgets).values({
    id: `b-${categoryId}-${++seq}`,
    userId: USER,
    budgetId: PLAN,
    categoryId,
    amount,
    period: "monthly",
    isActive: true,
    status: "active",
    createdAt,
  });
}

/** The plan as the API layer resolves it, since buildLedgerYear takes one. */
function planFor(periodStartedAt: string | null = null) {
  return {
    id: PLAN,
    name: "Main",
    isMain: true,
    period: "yearly" as const,
    periodStartedAt,
    accountIds: ["acct-1"],
    ownerId: USER,
    role: "owner" as const,
    ownerName: null,
  };
}

/** The derived chain for one category, months in order. */
async function ledgerFor(
  categoryId: string,
  now = AFTER_YEAR,
  periodStartedAt: string | null = null,
) {
  const all = await buildLedgerYear(USER, planFor(periodStartedAt), YEAR, 1, now);
  return all.find((c) => c.categoryId === categoryId)?.months ?? [];
}

beforeEach(async () => {
  await testDb.reset();
  await db.insert(budgetPlans).values([
    {
      id: PLAN,
      userId: USER,
      name: "Main",
      isMain: true,
      period: "yearly",
      periodStartedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: OTHER_PLAN,
      userId: USER,
      name: "Side",
      isMain: false,
      period: "monthly",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ]);
  await db.insert(accounts).values([
    {
      id: "acct-1",
      userId: USER,
      name: "Checking",
      type: "checking",
      budgetId: PLAN,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    {
      id: "acct-out",
      userId: USER,
      name: "Outside",
      type: "checking",
      budgetId: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ]);
  await db.insert(categories).values([
    { id: "c-food", userId: USER, name: "Food", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "c-fun", userId: USER, name: "Fun", createdAt: "2025-01-01T00:00:00.000Z" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("financial-month bucketing in SQL matches the JS rule", () => {
  const EDGE_DATES = [
    "2026-01-01",
    "2026-01-24",
    "2026-01-25",
    "2026-01-31",
    "2026-02-28",
    "2026-03-01",
    "2026-06-30",
    "2026-12-24",
    "2026-12-25",
    "2026-12-31",
  ];

  for (const startDay of [1, 25]) {
    it(`agrees on every edge date with startDay = ${startDay}`, async () => {
      for (const date of EDGE_DATES) await expense(date, 10);

      const spend = await getYearSpendByCategoryMonth(USER, YEAR, startDay, ["acct-1"]);
      const byMonth = spend.get("c-food") ?? new Map();

      // Rebuild the same histogram with the pure helper and compare.
      const expected = new Map<number, number>();
      for (const date of EDGE_DATES) {
        const slot = financialSlotOf(date, startDay);
        if (slot.year !== YEAR) continue;
        expected.set(slot.monthIndex, (expected.get(slot.monthIndex) ?? 0) + 10);
      }

      expect(Object.fromEntries(byMonth)).toEqual(Object.fromEntries(expected));
    });
  }

  it("drops spending that falls outside the financial year", async () => {
    // With startDay 25, 10 Jan 2026 belongs to financial year 2025 and drops
    // out; 10 Jun lands in the month that opened 25 May, index 4.
    await expense("2026-01-10", 50);
    await expense("2026-06-10", 70);
    const spend = await getYearSpendByCategoryMonth(USER, YEAR, 25, ["acct-1"]);
    expect(Object.fromEntries(spend.get("c-food") ?? new Map())).toEqual({ 4: 70 });
  });
});

describe("getYearSpendByCategoryMonth — what counts as spend", () => {
  it("nets reimbursements off the expense", async () => {
    await expense("2026-03-04", 200, { id: "tx-exp" });
    await db.insert(transactions).values({
      id: "tx-reimb",
      userId: USER,
      accountId: "acct-1",
      date: "2026-03-20",
      description: "back",
      amount: 50,
      type: "reimbursement",
      categoryId: "c-food",
    });
    await db.insert(reimbursementLinks).values({
      id: "rl-1",
      reimbursementId: "tx-reimb",
      expenseId: "tx-exp",
      createdAt: "2026-03-20T00:00:00.000Z",
    });

    const spend = await getYearSpendByCategoryMonth(USER, YEAR, 1, ["acct-1"]);
    expect(spend.get("c-food")?.get(2)).toBe(150);
  });

  it("counts a pot's net spend against the pot's category", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: USER,
      name: "Trip",
      categoryId: "c-fun",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await expense("2026-04-02", 300, { groupId: "pot-1", categoryId: "c-fun" });
    await expense("2026-04-09", 40, { categoryId: "c-fun" });

    const spend = await getYearSpendByCategoryMonth(USER, YEAR, 1, ["acct-1"]);
    expect(spend.get("c-fun")?.get(3)).toBe(340);
  });

  it("floors a pot that nets positive in a month at zero", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-2",
      userId: USER,
      name: "Refunded",
      categoryId: "c-fun",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await expense("2026-05-02", 100, { groupId: "pot-2", categoryId: "c-fun" });
    await db.insert(transactions).values({
      id: "tx-refund",
      userId: USER,
      accountId: "acct-1",
      date: "2026-05-20",
      description: "refund",
      amount: 250,
      type: "income",
      categoryId: "c-fun",
      groupId: "pot-2",
    });

    const spend = await getYearSpendByCategoryMonth(USER, YEAR, 1, ["acct-1"]);
    expect(spend.get("c-fun")?.get(4) ?? 0).toBe(0);
  });

  it("ignores accounts outside the plan", async () => {
    await expense("2026-02-02", 90, { accountId: "acct-out" });
    await expense("2026-02-03", 10);
    const spend = await getYearSpendByCategoryMonth(USER, YEAR, 1, ["acct-1"]);
    expect(spend.get("c-food")?.get(1)).toBe(10);
  });
});

describe("buildLedgerYear — the envelope over a whole year", () => {
  it("writes twelve months with the carry-over chain resolved", async () => {
    await allocate("c-food", 100);
    await expense("2026-01-10", 60);

    const months = await ledgerFor("c-food");

    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({
      target: 100,
      spent: 60,
      rolloverIn: 0,
      rolloverOut: 40,
      allowance: 100,
    });
    expect(months[1]).toMatchObject({ rolloverIn: 40, allowance: 140 });
    // Nothing else was spent, so the year ends with eleven untouched months
    // plus January's leftover.
    expect(months[11].rolloverOut).toBe(1140);
  });

  it("carries an overspend forward as debt", async () => {
    await allocate("c-food", 100);
    await expense("2026-01-10", 400);

    const months = await ledgerFor("c-food");

    expect(months[0].rolloverOut).toBe(-300);
    expect(months[1].allowance).toBe(-200);
  });

  it("re-cascades when an old transaction is corrected later", async () => {
    await allocate("c-food", 100);
    const txId = await expense("2026-02-10", 100);
    expect((await ledgerFor("c-food"))[2].rolloverIn).toBe(100);

    // In September the user re-categorises February's expense away.
    await db
      .update(transactions)
      .set({ categoryId: "c-fun" })
      .where(and(eq(transactions.userId, USER), eq(transactions.id, txId)));

    const months = await ledgerFor("c-food");
    expect(months[1].spent).toBe(0);
    // March onward all shift by the corrected 100.
    expect(months[2].rolloverIn).toBe(200);
    expect(months[11].rolloverOut).toBe(1200);
  });

  it("freezes a closed month's target and gives a raise to the rest", async () => {
    await allocate("c-food", 100);
    // Read with "now" in July: Jan–Jun are closed at 100, and freeze there.
    const firstPass = await ledgerFor("c-food", new Date(2026, 6, 15));
    expect(firstPass.slice(0, 6).every((m) => m.closed)).toBe(true);
    expect(firstPass[6].closed).toBe(false);

    // Raise to 150 and recompute — still in July.
    await db
      .update(budgets)
      .set({ amount: 150 })
      .where(and(eq(budgets.userId, USER), eq(budgets.categoryId, "c-food")));

    const months = await ledgerFor("c-food", new Date(2026, 6, 20));
    expect(months.slice(0, 6).map((m) => m.target)).toEqual(Array(6).fill(100));
    expect(months.slice(6).map((m) => m.target)).toEqual(Array(6).fill(150));
    expect(months.reduce((s, m) => s + m.target, 0)).toBe(1500);
  });

  it("starts at the switch month when a plan turned yearly mid-year", async () => {
    await allocate("c-food", 100);
    await expense("2026-03-10", 500); // before the switch

    const months = await ledgerFor("c-food", AFTER_YEAR, "2026-07-01");

    expect(months.map((m) => m.monthIndex)).toEqual([6, 7, 8, 9, 10, 11]);
    // The pre-switch overspend is history — July opens with a clean slate.
    expect(months[0].rolloverIn).toBe(0);
    expect(months.reduce((s, m) => s + m.target, 0)).toBe(600);
  });

  it("prorates a category allocated mid-year", async () => {
    await allocate("c-food", 100, "2026-07-04T10:00:00.000Z");

    const months = await ledgerFor("c-food");
    expect(months.map((m) => m.monthIndex)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(months.reduce((s, m) => s + m.target, 0)).toBe(600);
  });

  it("drops a category as soon as its allocation is deleted", async () => {
    await allocate("c-food", 100);
    await allocate("c-fun", 50);
    expect(await buildLedgerYear(USER, planFor(), YEAR, 1, AFTER_YEAR)).toHaveLength(2);

    await db
      .delete(budgets)
      .where(and(eq(budgets.userId, USER), eq(budgets.categoryId, "c-fun")));

    const remaining = await buildLedgerYear(USER, planFor(), YEAR, 1, AFTER_YEAR);
    expect(remaining.map((c) => c.categoryId)).toEqual(["c-food"]);
  });

  it("keeps each financial year's envelope separate", async () => {
    await allocate("c-food", 100);
    await expense("2025-12-10", 900);
    await expense("2026-01-10", 10);

    const months = await ledgerFor("c-food");
    // 2025's spending is not this year's problem.
    expect(months[0].spent).toBe(10);
    expect(months[0].rolloverIn).toBe(0);
  });

  it("derives the same chain twice and freezes each closed month once", async () => {
    await allocate("c-food", 100);
    await expense("2026-01-10", 60);
    const first = await ledgerFor("c-food");
    const second = await ledgerFor("c-food");

    expect(second).toEqual(first);
    // Twelve closed months, frozen on the first read and not duplicated on the
    // second — the insert is conflict-tolerant precisely so reads can race.
    const rows = await db
      .select()
      .from(budgetMonthTargets)
      .where(eq(budgetMonthTargets.userId, USER));
    expect(rows).toHaveLength(12);
  });

  it("keeps a frozen target even after the allocation changes", async () => {
    await allocate("c-food", 100);
    await ledgerFor("c-food", new Date(2026, 6, 15)); // freezes Jan–Jun at 100
    await db
      .update(budgets)
      .set({ amount: 999 })
      .where(and(eq(budgets.userId, USER), eq(budgets.categoryId, "c-food")));

    // Even read from beyond the year — when every month is closed — the six
    // months that were already frozen keep the target they closed with.
    const months = await ledgerFor("c-food", AFTER_YEAR);
    expect(months.slice(0, 6).map((m) => m.target)).toEqual(Array(6).fill(100));
    expect(months.slice(6).map((m) => m.target)).toEqual(Array(6).fill(999));
  });

  it("freeze: false derives the same chain without recording anything", async () => {
    await allocate("c-food", 100);

    const readOnly = await buildLedgerYear(
      USER,
      planFor(null),
      YEAR,
      1,
      AFTER_YEAR,
      false,
    );

    // Same numbers a freezing read would produce…
    expect(readOnly[0].months.map((m) => m.target)).toEqual(Array(12).fill(100));
    // …but the render path left no rows behind.
    expect(
      await db.select().from(budgetMonthTargets).where(eq(budgetMonthTargets.userId, USER)),
    ).toHaveLength(0);

    // And a later freezing read still gets to record them.
    await ledgerFor("c-food");
    expect(
      await db.select().from(budgetMonthTargets).where(eq(budgetMonthTargets.userId, USER)),
    ).toHaveLength(12);
  });

  it("clearLedger drops the frozen targets when a plan goes back to monthly", async () => {
    await allocate("c-food", 100);
    await ledgerFor("c-food");
    expect(
      await db.select().from(budgetMonthTargets).where(eq(budgetMonthTargets.userId, USER)),
    ).not.toHaveLength(0);

    await clearLedger(USER, PLAN);

    expect(
      await db.select().from(budgetMonthTargets).where(eq(budgetMonthTargets.userId, USER)),
    ).toHaveLength(0);
  });
});

describe("planStartMonthIndex", () => {
  it("covers the whole year for a plan that has always been yearly", () => {
    expect(planStartMonthIndex(null, 2026, 1)).toBe(0);
  });

  it("starts at the switch month within the switch year", () => {
    expect(planStartMonthIndex("2026-07-01", 2026, 1)).toBe(6);
  });

  it("covers later years in full", () => {
    expect(planStartMonthIndex("2026-07-01", 2027, 1)).toBe(0);
  });

  it("covers nothing in years before the switch", () => {
    expect(planStartMonthIndex("2026-07-01", 2025, 1)).toBe(12);
  });
});
