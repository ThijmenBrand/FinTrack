/**
 * The dashboard's money tiles, and the promise that they agree.
 *
 * `getMonthSummary` draws Earned / Spent / Net and the total balance;
 * `getMonthMoneyMath` draws Free to Spend right beside it. They have to see the
 * same accounts and the same euros, or one card contradicts the other on the
 * same screen.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("month-summary");

const { getMonthSummary, getAccountBalances } = await import(
  "@/app/(app)/_lib/dashboard-queries"
);
const { getMonthMoneyMath } = await import("@/lib/month-money");
const { db } = await import("@/db");
const {
  accountMembers,
  accounts,
  categories,
  recurringTransactions,
  reimbursementLinks,
  transactionGroups,
  transactions,
} = await import("@/db/schema");
const { and, eq } = await import("drizzle-orm");

const ME = "summary-me";
const OWNER = "summary-owner";
const STRANGER = "summary-stranger";
const TODAY = new Date().toISOString().slice(0, 10);
let seq = 0;

type TxOpts = {
  id?: string;
  userId?: string;
  accountId?: string;
  date?: string;
  type?: "income" | "expense" | "internal_transfer" | "reimbursement";
  categoryId?: string | null;
  groupId?: string | null;
  recurringTransactionId?: string | null;
  linkedTransactionId?: string | null;
  isSplitParent?: boolean;
  parentTransactionId?: string | null;
};

function tx(amount: number, opts: TxOpts = {}) {
  const id = opts.id ?? `tx-${++seq}`;
  return db
    .insert(transactions)
    .values({
      id,
      userId: opts.userId ?? ME,
      accountId: opts.accountId ?? "acc-mine",
      date: opts.date ?? TODAY,
      description: "t",
      amount,
      type: opts.type ?? (amount < 0 ? "expense" : "income"),
      categoryId: opts.categoryId ?? null,
      groupId: opts.groupId ?? null,
      recurringTransactionId: opts.recurringTransactionId ?? null,
      linkedTransactionId: opts.linkedTransactionId ?? null,
      isSplitParent: opts.isSplitParent ?? false,
      parentTransactionId: opts.parentTransactionId ?? null,
    })
    .then(() => id);
}

/** Bob is an active editor on Alice's joint account. */
async function shareJointWithMe(role: "editor" | "viewer" = "editor") {
  await db.insert(accountMembers).values({
    id: `am-${++seq}`,
    accountId: "acc-joint",
    userId: ME,
    email: "me@test.dev",
    role,
    acceptedAt: TODAY,
  });
}

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES
       ('${ME}','Bob','me@test.dev'),
       ('${OWNER}','Alice','alice@test.dev'),
       ('${STRANGER}','Eve','eve@test.dev')`,
  );
  await db.insert(accounts).values([
    { id: "acc-mine", userId: ME, name: "Mine", type: "checking" },
    { id: "acc-savings", userId: ME, name: "Savings", type: "savings" },
    { id: "acc-joint", userId: OWNER, name: "Joint", type: "checking" },
    { id: "acc-hidden", userId: STRANGER, name: "Hidden", type: "checking" },
  ]);
  await db.insert(categories).values([
    { id: "cat-food", userId: ME, name: "Food" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("getMonthSummary", () => {
  it("adds income, nets reimbursements off expenses and totals the balances", async () => {
    await db
      .update(accounts)
      .set({ initialBalance: 100 })
      .where(and(eq(accounts.id, "acc-mine"), eq(accounts.userId, ME)));
    await tx(2000, { type: "income" });
    const expenseId = await tx(-300);
    const refundId = await tx(120, { type: "reimbursement" });
    await db.insert(reimbursementLinks).values({
      id: "rl-1",
      reimbursementId: refundId,
      expenseId,
    });

    const r = await getMonthSummary(ME, 1);

    expect(r.monthIncome).toBe(2000);
    expect(r.monthExpenses).toBe(180);
    // Balance is the raw ledger: 100 opening + 2000 − 300 + 120.
    expect(r.totalBalance).toBe(1920);
    expect(r.accountCount).toBe(2); // own two; the joint one is not shared yet
  });

  it("counts a pot's net spend once and keeps its members out of income", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: ME,
      name: "Trip",
    });
    await tx(-500, { groupId: "pot-1" });
    await tx(200, { type: "income", groupId: "pot-1" }); // a refund inside the pot

    const r = await getMonthSummary(ME, 1);

    expect(r.monthIncome).toBe(0);
    expect(r.monthExpenses).toBe(300);
  });

  it("reports nothing spent for a pot that took in more than it spent", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: ME,
      name: "Trip",
    });
    await tx(-100, { groupId: "pot-1" });
    await tx(400, { type: "income", groupId: "pot-1" });

    const r = await getMonthSummary(ME, 1);

    expect(r.monthExpenses).toBe(0);
  });

  it("ignores internal transfers into a pot — funding is not spending", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: ME,
      name: "Trip",
    });
    await tx(-250, { groupId: "pot-1", type: "internal_transfer" });

    const r = await getMonthSummary(ME, 1);

    expect(r.monthExpenses).toBe(0);
  });

  it("counts a split's children, not its wrapper", async () => {
    await tx(-100, { id: "parent", isSplitParent: true });
    await tx(-60, { parentTransactionId: "parent" });
    await tx(-40, { parentTransactionId: "parent" });

    const r = await getMonthSummary(ME, 1);

    expect(r.monthExpenses).toBe(100);
    // The balance takes the wrapper instead, so the split does not double it.
    expect(r.totalBalance).toBe(-100);
  });

  it("leaves last month and next month out", async () => {
    await tx(-99, { date: "2000-01-05" });
    await tx(-99, { date: "2099-01-05" });

    const r = await getMonthSummary(ME, 1);

    expect(r.monthExpenses).toBe(0);
  });

  it("restricts the month's money to the given accounts but not the balance", async () => {
    await tx(-100, { accountId: "acc-mine" });
    await tx(-70, { accountId: "acc-savings" });

    const scoped = await getMonthSummary(ME, 1, ["acc-mine"]);
    expect(scoped.monthExpenses).toBe(100);
    // Total balance is every visible account, whatever the tile scope is.
    expect(scoped.totalBalance).toBe(-170);
  });

  it("follows money transferred out of the scope into the account that spent it", async () => {
    await tx(-500, {
      id: "out",
      accountId: "acc-mine",
      type: "internal_transfer",
      linkedTransactionId: "in",
    });
    await tx(500, {
      id: "in",
      accountId: "acc-savings",
      type: "internal_transfer",
      linkedTransactionId: "out",
    });
    await tx(-80, { accountId: "acc-savings" });

    // Scoped to the checking account only — but the savings spending was funded
    // from it this month, so it still counts.
    const r = await getMonthSummary(ME, 1, ["acc-mine"]);
    expect(r.monthExpenses).toBe(80);
  });

  it("sees a shared account's money once it is accepted, and never before", async () => {
    await tx(1000, { userId: OWNER, accountId: "acc-joint", type: "income" });
    await tx(-400, { userId: OWNER, accountId: "acc-joint" });

    const before = await getMonthSummary(ME, 1);
    expect(before.monthIncome).toBe(0);
    expect(before.accountCount).toBe(2);

    await shareJointWithMe();
    const after = await getMonthSummary(ME, 1);
    expect(after.monthIncome).toBe(1000);
    expect(after.monthExpenses).toBe(400);
    expect(after.accountCount).toBe(3);
  });

  it("never sees a stranger's account", async () => {
    await tx(9999, {
      userId: STRANGER,
      accountId: "acc-hidden",
      type: "income",
    });

    const r = await getMonthSummary(ME, 1);

    expect(r.monthIncome).toBe(0);
    expect(r.totalBalance).toBe(0);
  });
});

describe("getMonthMoneyMath agrees with getMonthSummary", () => {
  /** Both cards, over the same accounts, as the dashboard asks for them. */
  const both = async (accountIds?: string[]) =>
    Promise.all([
      getMonthSummary(ME, 1, accountIds),
      getMonthMoneyMath(ME, 1, { accountIds }),
    ]);

  it("on plain income and spending", async () => {
    await tx(2500, { type: "income" });
    await tx(-400, { categoryId: "cat-food" });

    const [summary, math] = await both();

    expect(math.monthlyIncome).toBe(summary.monthIncome);
    expect(math.spentThisMonth).toBe(summary.monthExpenses);
    expect(math.freeToSpend).toBe(2100);
  });

  it("on a shared account the member can see", async () => {
    await shareJointWithMe();
    await tx(1800, { userId: OWNER, accountId: "acc-joint", type: "income" });
    await tx(-300, { userId: OWNER, accountId: "acc-joint" });

    const [summary, math] = await both(["acc-mine", "acc-joint"]);

    // The whole point: joint money is in both cards or in neither.
    expect(math.monthlyIncome).toBe(summary.monthIncome);
    expect(math.monthlyIncome).toBe(1800);
    expect(math.spentThisMonth).toBe(summary.monthExpenses);
    expect(math.spentThisMonth).toBe(300);
  });

  it("on a viewer-shared account too — reading is reading", async () => {
    await shareJointWithMe("viewer");
    await tx(900, { userId: OWNER, accountId: "acc-joint", type: "income" });

    const [summary, math] = await both();

    expect(math.monthlyIncome).toBe(summary.monthIncome);
    expect(math.monthlyIncome).toBe(900);
  });

  it("stops seeing it the moment the share is revoked", async () => {
    await shareJointWithMe();
    await tx(900, { userId: OWNER, accountId: "acc-joint", type: "income" });
    await db
      .update(accountMembers)
      .set({ revokedAt: TODAY })
      .where(eq(accountMembers.userId, ME));

    const [summary, math] = await both();

    expect(summary.monthIncome).toBe(0);
    expect(math.monthlyIncome).toBe(0);
  });

  it("on pots, which both net per pot", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: ME,
      name: "Trip",
    });
    await tx(3000, { type: "income" });
    await tx(-500, { groupId: "pot-1" });
    await tx(50, { type: "income", groupId: "pot-1" });

    const [summary, math] = await both();

    expect(math.spentThisMonth).toBe(summary.monthExpenses);
    expect(math.spentThisMonth).toBe(450);
  });

  it("on a reimbursement split across two expenses", async () => {
    await tx(1000, { type: "income" });
    const a = await tx(-200);
    const b = await tx(-300);
    const refund = await tx(100, { type: "reimbursement" });
    await db.insert(reimbursementLinks).values([
      { id: "rl-a", reimbursementId: refund, expenseId: a },
      { id: "rl-b", reimbursementId: refund, expenseId: b },
    ]);

    const [summary, math] = await both();

    // €100 spread over two expenses: €50 off each, so it comes off once in
    // total — 500 gross becomes 400, not 300.
    expect(math.spentThisMonth).toBe(400);
    expect(math.spentThisMonth).toBe(summary.monthExpenses);
  });

  it("floors an over-reimbursed expense at zero on both sides", async () => {
    const a = await tx(-40);
    const refund = await tx(100, { type: "reimbursement" });
    await db.insert(reimbursementLinks).values({
      id: "rl-a",
      reimbursementId: refund,
      expenseId: a,
    });

    const [summary, math] = await both();

    expect(math.spentThisMonth).toBe(0);
    expect(summary.monthExpenses).toBe(0);
  });

  it("but deliberately parts ways on recurring bills, which Free to Spend reserves", async () => {
    await db.insert(recurringTransactions).values({
      id: "rec-rent",
      userId: ME,
      accountId: "acc-mine",
      description: "Rent",
      amount: -1000,
      type: "expense",
      frequency: "monthly",
      startDate: "2020-01-01",
    });
    await tx(3000, { type: "income" });
    await tx(-1000, { recurringTransactionId: "rec-rent" });

    const [summary, math] = await both();

    // The bill really left the account, so Spent counts it…
    expect(summary.monthExpenses).toBe(1000);
    // …while Free to Spend holds it as a reserved fixed cost instead, exactly
    // once: 3000 − 1000 reserved − 0 discretionary.
    expect(math.totalFixedCosts).toBe(1000);
    expect(math.spentThisMonth).toBe(0);
    expect(math.freeToSpend).toBe(2000);
  });

  it("reserves the larger of plan and reality when a bill comes in high", async () => {
    await db.insert(recurringTransactions).values({
      id: "rec-gas",
      userId: ME,
      accountId: "acc-mine",
      description: "Gas",
      amount: -100,
      type: "expense",
      frequency: "monthly",
      startDate: "2020-01-01",
    });
    await tx(-180, { recurringTransactionId: "rec-gas" });

    const math = await getMonthMoneyMath(ME, 1);

    expect(math.totalFixedCosts).toBe(180);
    expect(math.spentThisMonth).toBe(0);
  });

  it("counts a shared account's recurring plan for a member who can see it", async () => {
    await shareJointWithMe();
    await db.insert(recurringTransactions).values({
      id: "rec-joint-rent",
      userId: OWNER,
      accountId: "acc-joint",
      description: "Rent",
      amount: -800,
      type: "expense",
      frequency: "monthly",
      startDate: "2020-01-01",
    });

    const math = await getMonthMoneyMath(ME, 1);

    expect(math.totalFixedCosts).toBe(800);
  });

  it("never counts a stranger's plan", async () => {
    await db.insert(recurringTransactions).values({
      id: "rec-eve",
      userId: STRANGER,
      accountId: "acc-hidden",
      description: "Yacht",
      amount: -5000,
      type: "expense",
      frequency: "monthly",
      startDate: "2020-01-01",
    });

    const math = await getMonthMoneyMath(ME, 1);

    expect(math.totalFixedCosts).toBe(0);
  });
});

describe("getAccountBalances", () => {
  it("is opening balance plus every row on the account", async () => {
    await db
      .update(accounts)
      .set({ initialBalance: 250 })
      .where(and(eq(accounts.id, "acc-mine"), eq(accounts.userId, ME)));
    await tx(1000, { type: "income" });
    await tx(-400);
    // Future-dated money counts: the balance is the whole ledger, not today's.
    await tx(-25, { date: "2099-06-01" });

    const rows = await getAccountBalances(ME);
    const mine = rows.find((a) => a.id === "acc-mine")!;

    expect(mine.currentBalance).toBe(825);
  });

  it("takes the split wrapper and not its children", async () => {
    await tx(-100, { id: "parent", isSplitParent: true });
    await tx(-60, { parentTransactionId: "parent" });
    await tx(-40, { parentTransactionId: "parent" });

    const rows = await getAccountBalances(ME);

    expect(rows.find((a) => a.id === "acc-mine")!.currentBalance).toBe(-100);
  });

  it("lists an account with no transactions at zero rather than dropping it", async () => {
    const rows = await getAccountBalances(ME);

    expect(rows.map((a) => a.id).sort()).toEqual(["acc-mine", "acc-savings"]);
    expect(rows.every((a) => a.currentBalance === 0)).toBe(true);
  });

  it("names the owner on a shared account and counts their rows", async () => {
    await shareJointWithMe();
    await tx(700, { userId: OWNER, accountId: "acc-joint", type: "income" });

    const rows = await getAccountBalances(ME);
    const joint = rows.find((a) => a.id === "acc-joint")!;

    expect(joint.currentBalance).toBe(700);
    expect(joint.ownerName).toBe("Alice");
  });
});
