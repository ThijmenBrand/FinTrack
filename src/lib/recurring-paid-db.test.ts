/**
 * "Has this bill already gone out?"
 *
 * `lastPaidByPlan` is the only read behind the paid/upcoming state of a
 * recurring plan, and `isOccurrencePaid` turns it into a per-occurrence answer.
 * A wrong answer here either hides a bill that is still coming or keeps
 * nagging about one that has already left the account.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("recurring-paid");

const { lastPaidByPlan } = await import("@/lib/recurring-paid");
const { isOccurrencePaid } = await import("@/lib/recurring");
const { db } = await import("@/db");
const { accountMembers, accounts, recurringTransactions, transactions } =
  await import("@/db/schema");

const ME = "paid-me";
const OWNER = "paid-owner";
const STRANGER = "paid-stranger";
let seq = 0;

function plan(id: string, opts: { userId?: string; accountId?: string } = {}) {
  return db.insert(recurringTransactions).values({
    id,
    userId: opts.userId ?? ME,
    accountId: opts.accountId ?? "acc-mine",
    description: id,
    amount: -100,
    type: "expense",
    frequency: "monthly",
    dayOfMonth: 1,
    startDate: "2026-01-01",
  });
}

function payment(
  planId: string | null,
  date: string,
  opts: { userId?: string; accountId?: string } = {},
) {
  return db.insert(transactions).values({
    id: `tx-${++seq}`,
    userId: opts.userId ?? ME,
    accountId: opts.accountId ?? "acc-mine",
    date,
    description: "t",
    amount: -100,
    type: "expense",
    recurringTransactionId: planId,
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
    { id: "acc-joint", userId: OWNER, name: "Joint", type: "checking" },
    { id: "acc-hidden", userId: STRANGER, name: "Hidden", type: "checking" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("lastPaidByPlan", () => {
  it("returns the newest payment per plan", async () => {
    await plan("p-rent");
    await plan("p-gym");
    await payment("p-rent", "2026-01-01");
    await payment("p-rent", "2026-03-01");
    await payment("p-rent", "2026-02-01");
    await payment("p-gym", "2026-02-14");

    const map = await lastPaidByPlan(["p-rent", "p-gym"], ME);

    expect(map.get("p-rent")).toBe("2026-03-01");
    expect(map.get("p-gym")).toBe("2026-02-14");
  });

  it("leaves a plan that has never been paid out of the map entirely", async () => {
    await plan("p-rent");

    const map = await lastPaidByPlan(["p-rent"], ME);

    expect(map.has("p-rent")).toBe(false);
    expect(map.size).toBe(0);
  });

  it("short-circuits on an empty plan list", async () => {
    expect(await lastPaidByPlan([], ME)).toEqual(new Map());
  });

  it("ignores plans that were not asked about", async () => {
    await plan("p-rent");
    await plan("p-gym");
    await payment("p-rent", "2026-01-01");
    await payment("p-gym", "2026-01-02");

    const map = await lastPaidByPlan(["p-gym"], ME);

    expect([...map.keys()]).toEqual(["p-gym"]);
  });

  it("ignores transactions with no plan behind them", async () => {
    await plan("p-rent");
    await payment(null, "2026-05-01");

    expect(await lastPaidByPlan(["p-rent"], ME)).toEqual(new Map());
  });

  it("finds a payment on a shared account, whose rows carry the owner's id", async () => {
    await plan("p-joint", { userId: OWNER, accountId: "acc-joint" });
    await payment("p-joint", "2026-04-01", {
      userId: OWNER,
      accountId: "acc-joint",
    });
    await db.insert(accountMembers).values({
      id: "am-1",
      accountId: "acc-joint",
      userId: ME,
      email: "me@test.dev",
      role: "viewer",
      acceptedAt: "2026-01-01",
    });

    const map = await lastPaidByPlan(["p-joint"], ME);

    expect(map.get("p-joint")).toBe("2026-04-01");
  });

  it("finds nothing on an account that is not shared", async () => {
    await plan("p-joint", { userId: OWNER, accountId: "acc-joint" });
    await payment("p-joint", "2026-04-01", {
      userId: OWNER,
      accountId: "acc-joint",
    });

    expect(await lastPaidByPlan(["p-joint"], ME)).toEqual(new Map());
  });

  it("never reaches a stranger's payment for a plan id it happens to know", async () => {
    await plan("p-eve", { userId: STRANGER, accountId: "acc-hidden" });
    await payment("p-eve", "2026-04-01", {
      userId: STRANGER,
      accountId: "acc-hidden",
    });

    expect(await lastPaidByPlan(["p-eve"], ME)).toEqual(new Map());
  });

  it("compares dates as strings, which is why they have to be zero-padded ISO", async () => {
    await plan("p-rent");
    await payment("p-rent", "2026-09-30");
    await payment("p-rent", "2026-10-01");

    expect((await lastPaidByPlan(["p-rent"], ME)).get("p-rent")).toBe(
      "2026-10-01",
    );
  });
});

describe("isOccurrencePaid", () => {
  it("settles the occurrence the payment is closest to", () => {
    // Monthly: half a period is 15 days either way.
    expect(isOccurrencePaid("monthly", "2026-03-01", "2026-03-03")).toBe(true);
    expect(isOccurrencePaid("monthly", "2026-03-01", "2026-02-25")).toBe(true);
    expect(isOccurrencePaid("monthly", "2026-04-01", "2026-03-03")).toBe(false);
  });

  it("is never paid without a payment", () => {
    expect(isOccurrencePaid("monthly", "2026-03-01", null)).toBe(false);
    expect(isOccurrencePaid("monthly", "2026-03-01", undefined)).toBe(false);
  });

  it("keeps a weekly payment attached to its own week", () => {
    expect(isOccurrencePaid("weekly", "2026-03-02", "2026-03-04")).toBe(true);
    // 4 days out is past half a week, so it belongs to the next occurrence.
    expect(isOccurrencePaid("weekly", "2026-03-02", "2026-03-06")).toBe(false);
  });

  it("gives a yearly plan half a year of slack", () => {
    expect(isOccurrencePaid("yearly", "2026-06-01", "2026-09-01")).toBe(true);
    expect(isOccurrencePaid("yearly", "2026-06-01", "2026-12-31")).toBe(false);
  });

  it("falls back to a month for a frequency it does not know", () => {
    expect(isOccurrencePaid("fortnightly", "2026-03-01", "2026-03-05")).toBe(
      true,
    );
    expect(isOccurrencePaid("fortnightly", "2026-03-01", "2026-03-20")).toBe(
      false,
    );
  });

  it("is exclusive at exactly half a period, so no payment settles two occurrences", () => {
    // Biweekly: exactly 7 days is the midpoint between two occurrences.
    expect(isOccurrencePaid("biweekly", "2026-03-01", "2026-03-08")).toBe(false);
    expect(isOccurrencePaid("biweekly", "2026-03-15", "2026-03-08")).toBe(false);
    expect(isOccurrencePaid("biweekly", "2026-03-01", "2026-03-07")).toBe(true);
  });
});
