/**
 * The dashboard's "Upcoming bills & income" card.
 *
 * The card's promise is that its rows are money that has NOT moved yet, and
 * that its two totals are the sum of exactly those rows — so what's pinned
 * down here is everything the query leaves out: settled occurrences, transfers
 * between your own accounts, and past occurrences of plans whose payments have
 * never been matched to them.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("dashboard-upcoming");

const { getUpcomingMoney } = await import("@/app/(app)/_lib/dashboard-queries");
const { db } = await import("@/db");
const { accountMembers, accounts, categories, recurringTransactions, transactions } =
  await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const ME = "upcoming-me";
const OWNER = "upcoming-owner";
const NOW = new Date();

/** A date `offset` days from today, as YYYY-MM-DD (vitest pins TZ=UTC). */
const iso = (offset: number) =>
  new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
/** Day-of-month of that date, for a monthly plan that lands on it. */
const dayOf = (offset: number) => Number(iso(offset).slice(8, 10));

let seq = 0;

/**
 * A monthly plan landing `offset` days from today. Offsets are kept clear of
 * both window edges (−7 … +30), so each plan contributes exactly one
 * occurrence unless a test says otherwise.
 */
function plan(
  id: string,
  amount: number,
  offset: number,
  opts: {
    type?: "income" | "expense";
    accountId?: string;
    userId?: string;
    categoryId?: string | null;
  } = {},
) {
  return db.insert(recurringTransactions).values({
    id,
    userId: opts.userId ?? ME,
    accountId: opts.accountId ?? "acc-mine",
    description: id,
    amount: opts.type === "income" ? Math.abs(amount) : -Math.abs(amount),
    type: opts.type ?? "expense",
    categoryId: opts.categoryId ?? "cat-bills",
    frequency: "monthly",
    dayOfMonth: dayOf(offset),
    startDate: "2020-01-01",
  });
}

/** A payment matched to `planId` — what makes an occurrence settled. */
function payment(planId: string, date: string, amount = -100) {
  return db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: ME,
    accountId: "acc-mine",
    date,
    description: planId,
    amount,
    type: "expense",
    recurringTransactionId: planId,
  });
}

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES
       ('${ME}','Bob','me@test.dev'), ('${OWNER}','Alice','alice@test.dev')`,
  );
  await db.insert(accounts).values([
    { id: "acc-mine", userId: ME, name: "Checking", type: "checking" },
    { id: "acc-other", userId: ME, name: "Savings", type: "savings" },
    { id: "acc-joint", userId: OWNER, name: "Joint", type: "checking" },
  ]);
  await db.insert(categories).values([
    { id: "cat-bills", userId: ME, name: "Bills" },
    { id: "cat-salary", userId: ME, name: "Salary", kind: "income" },
    { id: "cat-move", userId: ME, name: "Transfers", kind: "transfer" },
    { id: "cat-owner-bills", userId: OWNER, name: "Alice bills" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("getUpcomingMoney", () => {
  it("lists what is going out and coming in, in date order", async () => {
    await plan("rec-rent", 1200, 10);
    await plan("rec-salary", 2500, 3, { type: "income", categoryId: "cat-salary" });

    const r = await getUpcomingMoney(ME);

    expect(r.events.map((e) => e.date)).toEqual([iso(3), iso(10)]);
    expect(r.events[0]).toMatchObject({
      planId: "rec-salary",
      amount: 2500,
      type: "income",
      daysUntil: 3,
      categoryName: "Salary",
      accountName: "Checking",
      overdue: false,
    });
    expect(r.events[1].amount).toBe(-1200);
    expect(r.incoming).toBe(2500);
    expect(r.outgoing).toBe(1200);
    expect(r.net).toBe(1300);
    expect(r.planCount).toBe(2);
  });

  it("drops an occurrence whose payment already landed", async () => {
    await plan("rec-rent", 1200, 5);
    await payment("rec-rent", iso(2), -1200);

    const r = await getUpcomingMoney(ME);

    expect(r.events).toHaveLength(0);
    expect(r.outgoing).toBe(0);
    // The plan is still there — it just has nothing left to announce.
    expect(r.planCount).toBe(1);
  });

  it("leaves transfers between your own accounts out of the rows and the totals", async () => {
    await plan("rec-rent", 1200, 5);
    await plan("rec-save", 300, 6, { categoryId: "cat-move" });

    const r = await getUpcomingMoney(ME);

    expect(r.events.map((e) => e.planId)).toEqual(["rec-rent"]);
    expect(r.outgoing).toBe(1200);
    expect(r.planCount).toBe(1);
  });

  it("calls a bill overdue only when that plan has been settled before", async () => {
    // Both were due three days ago. Only one has ever had a payment matched to
    // it, so only that one's silence means the money hasn't moved.
    await plan("rec-known", 100, -3);
    await plan("rec-never-matched", 100, -3);
    // Far enough back that it settles no occurrence in the window.
    await payment("rec-known", iso(-33));

    const r = await getUpcomingMoney(ME);

    const overdue = r.events.filter((e) => e.overdue);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      planId: "rec-known",
      date: iso(-3),
      daysUntil: -3,
    });
    expect(r.events.some((e) => e.planId === "rec-never-matched" && e.overdue)).toBe(
      false,
    );
  });

  it("narrows to the accounts it is given", async () => {
    await plan("rec-rent", 1200, 5);
    await plan("rec-gym", 30, 6, { accountId: "acc-other" });

    const r = await getUpcomingMoney(ME, ["acc-mine"]);

    expect(r.events.map((e) => e.planId)).toEqual(["rec-rent"]);
    expect(r.outgoing).toBe(1200);
  });

  it("includes plans on an account shared with you", async () => {
    // A shared plan keeps the OWNER's user_id, so ownership alone would miss it.
    await db.insert(accountMembers).values({
      id: "am-1",
      accountId: "acc-joint",
      userId: ME,
      email: "me@test.dev",
      role: "viewer",
      acceptedAt: iso(-30),
    });
    await plan("rec-joint-energy", 80, 4, {
      userId: OWNER,
      accountId: "acc-joint",
      categoryId: "cat-owner-bills",
    });

    const r = await getUpcomingMoney(ME);

    expect(r.events.map((e) => e.planId)).toEqual(["rec-joint-energy"]);
    expect(r.events[0].accountName).toBe("Joint");
  });

  it("says nothing is coming when every plan is paused", async () => {
    await plan("rec-rent", 1200, 5);
    await db
      .update(recurringTransactions)
      .set({ isActive: false })
      .where(eq(recurringTransactions.id, "rec-rent"));

    const r = await getUpcomingMoney(ME);

    expect(r.events).toHaveLength(0);
    expect(r.planCount).toBe(0);
  });
});
