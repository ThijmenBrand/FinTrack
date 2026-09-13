/**
 * Spikes (pots with a target amount + date) and the Top-spending card.
 *
 * A spike's money is counted in two places at once — it is real pot spending
 * the moment it happens, and a reservation against Free to Spend until then —
 * so the thing worth pinning down is that it is never counted twice.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("dashboard-spikes");

const { getMonthMoneyView, getSavingTowardSpikes, getTopCategories } =
  await import("@/app/(app)/_lib/dashboard-queries");
const { db } = await import("@/db");
const {
  accountMembers,
  accounts,
  budgets,
  categories,
  recurringTransactions,
  transactionGroups,
  transactions,
} = await import("@/db/schema");
const { and, eq } = await import("drizzle-orm");

const ME = "spikes-me";
const OWNER = "spikes-owner";
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
/** A date inside the current calendar month, clear of both edges. */
const MID_MONTH = `${TODAY.slice(0, 7)}-15`;
const MONTH_END = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0)
  .toISOString()
  .slice(0, 10);
/** `getSavingTowardSpikes` looks 365 days ahead, so its dates must fit inside. */
const daysFromNow = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const IN_200_DAYS = daysFromNow(200);
let seq = 0;

function tx(
  amount: number,
  opts: {
    userId?: string;
    accountId?: string;
    date?: string;
    type?: "income" | "expense" | "internal_transfer";
    categoryId?: string | null;
    groupId?: string | null;
  } = {},
) {
  return db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: opts.userId ?? ME,
    accountId: opts.accountId ?? "acc-mine",
    date: opts.date ?? TODAY,
    description: "t",
    amount,
    type: opts.type ?? (amount < 0 ? "expense" : "income"),
    categoryId: opts.categoryId ?? null,
    groupId: opts.groupId ?? null,
  });
}

function spike(
  id: string,
  targetAmount: number,
  targetDate: string,
  opts: { fundedAmount?: number; categoryId?: string | null; createdAt?: string } = {},
) {
  return db.insert(transactionGroups).values({
    id,
    userId: ME,
    name: id,
    categoryId: opts.categoryId ?? null,
    targetAmount,
    targetDate,
    fundedAmount: opts.fundedAmount ?? 0,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  });
}

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES
       ('${ME}','Bob','me@test.dev'), ('${OWNER}','Alice','alice@test.dev')`,
  );
  await db.insert(accounts).values([
    { id: "acc-mine", userId: ME, name: "Mine", type: "checking" },
    { id: "acc-savings", userId: ME, name: "Savings", type: "savings" },
    { id: "acc-joint", userId: OWNER, name: "Joint", type: "checking" },
  ]);
  await db.insert(categories).values([
    { id: "cat-holiday", userId: ME, name: "Holiday" },
    { id: "cat-food", userId: ME, name: "Food" },
    { id: "cat-transfer", userId: ME, name: "Transfers", kind: "transfer" },
  ]);
  // A salary on the 25th, so paydaysBetween has something real to walk.
  await db.insert(recurringTransactions).values({
    id: "rec-salary",
    userId: ME,
    accountId: "acc-mine",
    description: "Salary",
    amount: 3000,
    type: "income",
    frequency: "monthly",
    dayOfMonth: 25,
    startDate: "2020-01-25",
  });
});
afterAll(() => testDb.cleanup());

describe("getMonthMoneyView — this month's spikes", () => {
  it("reserves the whole target of a spike that has not spent yet", async () => {
    await tx(2000, { type: "income" });
    await spike("pot-trip", 500, MONTH_END);

    const r = await getMonthMoneyView(ME, 1);

    expect(r.freeToSpend).toBe(2000);
    expect(r.upcomingThisMonthTotal).toBe(500);
    expect(r.freeToSpendAfterSpikes).toBe(1500);
    expect(r.thisMonthSpikes).toHaveLength(1);
    expect(r.thisMonthSpikes[0]).toMatchObject({
      targetAmount: 500,
      remaining: 500,
      freeAfter: 1500,
      status: "fits",
    });
  });

  it("stops reserving what the spike has already spent this month", async () => {
    await tx(2000, { type: "income" });
    await spike("pot-trip", 500, MONTH_END);
    await tx(-200, { groupId: "pot-trip", date: MID_MONTH });

    const r = await getMonthMoneyView(ME, 1);

    // The 200 is already out of freeToSpend as pot spend; only 300 is still
    // coming, so the money is deducted once in total, not twice.
    expect(r.spentThisMonth).toBe(200);
    expect(r.freeToSpend).toBe(1800);
    expect(r.upcomingThisMonthTotal).toBe(300);
    expect(r.freeToSpendAfterSpikes).toBe(1500);
  });

  it("never reserves a negative amount once the spike has overspent", async () => {
    await tx(2000, { type: "income" });
    await spike("pot-trip", 500, MONTH_END);
    await tx(-900, { groupId: "pot-trip", date: MID_MONTH });

    const r = await getMonthMoneyView(ME, 1);

    expect(r.upcomingThisMonthTotal).toBe(0);
    expect(r.freeToSpendAfterSpikes).toBe(r.freeToSpend);
  });

  it("deducts earlier spikes first so each row's freeAfter accumulates in date order", async () => {
    await tx(1000, { type: "income" });
    await spike("pot-late", 400, MONTH_END);
    await spike("pot-early", 300, MID_MONTH >= TODAY ? MID_MONTH : MONTH_END);

    const r = await getMonthMoneyView(ME, 1);

    const dates = r.thisMonthSpikes.map((s) => s.targetDate);
    expect([...dates].sort()).toEqual(dates);
    // Running deduction: the last row's freeAfter is freeToSpend minus both.
    expect(r.thisMonthSpikes.at(-1)!.freeAfter).toBe(1000 - 700);
    expect(r.freeToSpendAfterSpikes).toBe(300);
  });

  it("calls a spike over when it cannot fit, and tight when it barely does", async () => {
    await tx(100, { type: "income" });
    await spike("pot-big", 500, MONTH_END);

    const over = await getMonthMoneyView(ME, 1);
    expect(over.thisMonthSpikes[0].status).toBe("over");

    await testDb.client.execute(
      `UPDATE transaction_groups SET target_amount = 95 WHERE id='pot-big' AND user_id='${ME}'`,
    );
    const tight = await getMonthMoneyView(ME, 1);
    // 5 left of 100 is under the 10% cushion.
    expect(tight.thisMonthSpikes[0].status).toBe("tight");
  });

  it("warns when a spike would push its category's allocation over", async () => {
    await tx(2000, { type: "income" });
    await db.insert(budgets).values({
      id: "b-holiday",
      userId: ME,
      categoryId: "cat-holiday",
      amount: 200,
      period: "monthly",
    });
    await spike("pot-trip", 500, MONTH_END, { categoryId: "cat-holiday" });

    const r = await getMonthMoneyView(ME, 1);

    expect(r.thisMonthSpikes[0].categoryWarning).toMatch(/Holiday/);
  });

  it("stays quiet when the category has room", async () => {
    await tx(2000, { type: "income" });
    await db.insert(budgets).values({
      id: "b-holiday",
      userId: ME,
      categoryId: "cat-holiday",
      amount: 900,
      period: "monthly",
    });
    await spike("pot-trip", 500, MONTH_END, { categoryId: "cat-holiday" });

    const r = await getMonthMoneyView(ME, 1);

    expect(r.thisMonthSpikes[0].categoryWarning).toBeNull();
  });

  it("ignores a pot with no target — that is a pot, not a spike", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-plain",
      userId: ME,
      name: "Loose change",
    });

    const r = await getMonthMoneyView(ME, 1);

    expect(r.thisMonthSpikes).toEqual([]);
    expect(r.upcomingThisMonthTotal).toBe(0);
  });

  it("ignores a spike due after this month", async () => {
    await spike("pot-later", 500, "2099-06-01");

    const r = await getMonthMoneyView(ME, 1);

    expect(r.thisMonthSpikes).toEqual([]);
  });

  it("ignores a spike whose date has already passed", async () => {
    await spike("pot-gone", 500, "2000-01-01");

    const r = await getMonthMoneyView(ME, 1);

    expect(r.thisMonthSpikes).toEqual([]);
  });
});

describe("getSavingTowardSpikes", () => {
  it("only returns spikes due after this month", async () => {
    await spike("pot-this-month", 100, MONTH_END);
    await spike("pot-later", 1200, IN_200_DAYS, { fundedAmount: 600 });

    const r = await getSavingTowardSpikes(ME, 1);

    expect(r.map((s) => s.id)).toEqual(["pot-later"]);
    expect(r[0]).toMatchObject({ targetAmount: 1200, fundedAmount: 600 });
    expect(r[0].remaining).toBe(600);
  });

  it("looks no further than a year ahead", async () => {
    await spike("pot-far", 1000, daysFromNow(400));

    expect(await getSavingTowardSpikes(ME, 1)).toEqual([]);
  });

  it("suggests what to put aside per remaining payday", async () => {
    await spike("pot-soon", 900, IN_200_DAYS, { fundedAmount: 0 });

    const [s] = await getSavingTowardSpikes(ME, 1);

    expect(s.paydaysRemaining).toBeGreaterThan(0);
    expect(s.suggestedAllocation).toBeCloseTo(900 / s.paydaysRemaining, 6);
    // Six-ish monthly paydays between now and then.
    expect(s.paydaysRemaining).toBeGreaterThanOrEqual(6);
  });

  it("asks for nothing more once a spike is fully funded", async () => {
    await spike("pot-done", 500, IN_200_DAYS, { fundedAmount: 500 });

    const [s] = await getSavingTowardSpikes(ME, 1);

    expect(s.remaining).toBe(0);
    expect(s.suggestedAllocation).toBe(0);
    expect(s.onTrack).toBe("ahead");
  });

  it("never reports a negative remaining for an over-funded spike", async () => {
    await spike("pot-over", 500, IN_200_DAYS, { fundedAmount: 800 });

    const [s] = await getSavingTowardSpikes(ME, 1);

    expect(s.remaining).toBe(0);
  });

  it("calls an untouched spike behind once paydays have gone by", async () => {
    // Created six months ago, nothing put aside since.
    await spike("pot-ignored", 1200, IN_200_DAYS, {
      fundedAmount: 0,
      createdAt: new Date(NOW.getTime() - 180 * 86_400_000).toISOString(),
    });

    const [s] = await getSavingTowardSpikes(ME, 1);

    expect(s.expectedFundedByNow).toBeGreaterThan(0);
    expect(s.onTrack).toBe("behind");
  });

  it("comes back empty when there is nothing saved toward", async () => {
    expect(await getSavingTowardSpikes(ME, 1)).toEqual([]);
  });
});

describe("getTopCategories", () => {
  it("ranks this month's spend and labels the budget the money left", async () => {
    await db.insert(accounts).values({
      id: "acc-plan",
      userId: ME,
      name: "Planned",
      type: "checking",
    });
    await tx(-300, { categoryId: "cat-food" });
    await tx(-80, { categoryId: "cat-holiday" });

    const r = await getTopCategories(ME, 1);

    expect(r.categories.map((c) => [c.name, c.total])).toEqual([
      ["Food", 300],
      ["Holiday", 80],
    ]);
    // No plan owns the account, so the money is labelled as unbudgeted.
    expect(r.categories[0].byBudget).toHaveLength(1);
  });

  it("keeps transfer-kind categories out — moving money is not spending", async () => {
    await tx(-500, { categoryId: "cat-transfer" });
    await tx(-10, { categoryId: "cat-food" });

    const r = await getTopCategories(ME, 1);

    expect(r.categories.map((c) => c.name)).toEqual(["Food"]);
  });

  it("keeps uncategorised spending, under its own label", async () => {
    await tx(-40, { categoryId: null });

    const r = await getTopCategories(ME, 1);

    expect(r.categories).toHaveLength(1);
    expect(r.categories[0].categoryId).toBeNull();
    expect(r.categories[0].total).toBe(40);
  });

  it("spans every visible account, own and shared alike", async () => {
    await db.insert(accountMembers).values({
      id: "am-1",
      accountId: "acc-joint",
      userId: ME,
      email: "me@test.dev",
      role: "viewer",
      acceptedAt: TODAY,
    });
    await db.insert(categories).values({
      id: "cat-owner-food",
      userId: OWNER,
      name: "Alice food",
    });
    await tx(-25, { accountId: "acc-savings", categoryId: "cat-food" });
    await tx(-75, {
      userId: OWNER,
      accountId: "acc-joint",
      categoryId: "cat-owner-food",
    });

    const r = await getTopCategories(ME, 1);

    expect(r.categories.map((c) => c.total).sort((a, b) => a - b)).toEqual([
      25, 75,
    ]);
  });

  it("keeps at most five categories", async () => {
    for (let i = 0; i < 7; i++) {
      await db.insert(categories).values({
        id: `cat-x${i}`,
        userId: ME,
        name: `X${i}`,
      });
      await tx(-(i + 1), { categoryId: `cat-x${i}` });
    }

    const r = await getTopCategories(ME, 1);

    expect(r.categories).toHaveLength(5);
    // Biggest first.
    expect(r.categories[0].total).toBe(7);
  });

  it("counts split children, not the wrapper", async () => {
    await db.insert(transactions).values({
      id: "parent",
      userId: ME,
      accountId: "acc-mine",
      date: TODAY,
      description: "shop",
      amount: -100,
      type: "expense",
      isSplitParent: true,
    });
    await db.insert(transactions).values({
      id: "child",
      userId: ME,
      accountId: "acc-mine",
      date: TODAY,
      description: "shop",
      amount: -100,
      type: "expense",
      categoryId: "cat-food",
      parentTransactionId: "parent",
    });

    const r = await getTopCategories(ME, 1);

    expect(r.categories.map((c) => [c.name, c.total])).toEqual([["Food", 100]]);
  });

  it("leaves pot members out — they are reported as pot spend, not category spend", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: ME,
      name: "Trip",
      categoryId: "cat-holiday",
    });
    await tx(-200, { groupId: "pot-1", categoryId: "cat-holiday" });

    const r = await getTopCategories(ME, 1);

    expect(r.categories).toEqual([]);
  });

  it("nets a reimbursement off the category it repaid", async () => {
    await tx(-100, { categoryId: "cat-food" });
    const [expenseRow] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, ME), eq(transactions.amount, -100)));
    await db.insert(transactions).values({
      id: "refund",
      userId: ME,
      accountId: "acc-mine",
      date: TODAY,
      description: "back",
      amount: 30,
      type: "reimbursement",
    });
    const { reimbursementLinks } = await import("@/db/schema");
    await db.insert(reimbursementLinks).values({
      id: "rl-1",
      reimbursementId: "refund",
      expenseId: expenseRow.id,
    });

    const r = await getTopCategories(ME, 1);

    expect(r.categories[0].total).toBe(70);
  });
});
