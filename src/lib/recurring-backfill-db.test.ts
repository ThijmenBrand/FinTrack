/**
 * `linkMatchingTransactions` — catching a plan's history up with its rule.
 * A wrong answer links someone else's money to a bill, or rewrites a link the
 * user made by hand.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("recurring-backfill");

const { linkMatchingTransactions } = await import("@/lib/recurring-backfill");
const { db } = await import("@/db");
const { recurringTransactions, transactions } = await import("@/db/schema");

const ME = "backfill-me";
const OTHER = "backfill-other";
let seq = 0;

function plan(id: string, opts: { matchPattern?: string | null; matchField?: "both" | "name" | "description"; accountId?: string } = {}) {
  return db.insert(recurringTransactions).values({
    id,
    userId: ME,
    accountId: opts.accountId ?? "acc",
    description: "HBO Max",
    amount: -4.5,
    type: "expense",
    frequency: "monthly",
    dayOfMonth: 1,
    startDate: "2026-01-01",
    matchPattern: opts.matchPattern ?? null,
    matchField: opts.matchField ?? "name",
  });
}

async function tx(opts: {
  name?: string | null;
  description?: string;
  amount?: number;
  accountId?: string;
  userId?: string;
  recurringId?: string | null;
  excludedFrom?: string | null;
  parentId?: string | null;
}) {
  const id = `tx-${++seq}`;
  const amount = opts.amount ?? -4.5;
  await db.insert(transactions).values({
    id,
    userId: opts.userId ?? ME,
    accountId: opts.accountId ?? "acc",
    date: `2026-0${(seq % 9) + 1}-01`,
    name: opts.name === undefined ? "HBO Max" : opts.name,
    description: opts.description ?? "Incasso ref",
    amount,
    type: amount < 0 ? "expense" : "income",
    recurringTransactionId: opts.recurringId ?? null,
    recurringExcludedPlanId: opts.excludedFrom ?? null,
    parentTransactionId: opts.parentId ?? null,
  });
  return id;
}

const linkOf = async (id: string) =>
  (
    await testDb.client.execute({
      sql: "SELECT recurring_transaction_id AS r FROM transactions WHERE id = ?",
      args: [id],
    })
  ).rows[0].r;

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES ('${ME}','Me','me@test.dev'), ('${OTHER}','Other','other@test.dev')`,
  );
  await testDb.client.execute(
    `INSERT INTO accounts (id, user_id, name, type, created_at, updated_at) VALUES
       ('acc','${ME}','Checking','checking','2026-01-01','2026-01-01'),
       ('acc-2','${ME}','Savings','savings','2026-01-01','2026-01-01'),
       ('acc-other','${OTHER}','Theirs','checking','2026-01-01','2026-01-01')`,
  );
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("linkMatchingTransactions", () => {
  it("links every rule match on the plan's account, at any price", async () => {
    await plan("p", { matchPattern: "HBO Max" });
    const old = await tx({ amount: -3.99 });
    const now = await tx({ amount: -4.5 });
    const raised = await tx({ amount: -5.99, name: "HBO MAX EUROPE" });

    expect(await linkMatchingTransactions("p", ME)).toHaveLength(3);
    for (const id of [old, now, raised]) expect(await linkOf(id)).toBe("p");
  });

  it("without a rule, links only what the description + amount guess finds", async () => {
    await plan("p");
    const close = await tx({ amount: -4.75 });
    const far = await tx({ amount: -12 });

    expect(await linkMatchingTransactions("p", ME)).toHaveLength(1);
    expect(await linkOf(close)).toBe("p");
    expect(await linkOf(far)).toBeNull();
  });

  it("leaves linked rows, other accounts, refunds and non-matches alone", async () => {
    await plan("p", { matchPattern: "HBO Max" });
    await plan("q");
    const elsewhere = await tx({ recurringId: "q" });
    const otherAccount = await tx({ accountId: "acc-2" });
    const refund = await tx({ amount: 4.5 });
    const unrelated = await tx({ name: "Spotify", description: "Spotify AB" });

    expect(await linkMatchingTransactions("p", ME)).toHaveLength(0);
    expect(await linkOf(elsewhere)).toBe("q");
    expect(await linkOf(otherAccount)).toBeNull();
    expect(await linkOf(refund)).toBeNull();
    expect(await linkOf(unrelated)).toBeNull();
  });

  it("never reaches into another owner's rows", async () => {
    await plan("p", { matchPattern: "HBO Max" });
    const theirs = await tx({ userId: OTHER, accountId: "acc-other" });
    expect(await linkMatchingTransactions("p", ME)).toHaveLength(0);
    expect(await linkOf(theirs)).toBeNull();
    // Nor does a stranger's call reach this plan at all.
    expect(await linkMatchingTransactions("p", OTHER)).toHaveLength(0);
  });

  it("matches bank rows and lets split slices follow their parent", async () => {
    await plan("p", { matchPattern: "HBO Max" });
    const parent = await tx({});
    const slice = await tx({ name: "Something else", parentId: parent });

    expect(await linkMatchingTransactions("p", ME)).toHaveLength(1);
    expect(await linkOf(parent)).toBe("p");
    expect(await linkOf(slice)).toBe("p");
  });

  it("keeps a row the user unlinked by hand away from that plan only", async () => {
    await plan("p", { matchPattern: "HBO Max" });
    await plan("q", { matchPattern: "HBO" });
    const unlinked = await tx({ excludedFrom: "p" });
    const fresh = await tx({});

    expect(await linkMatchingTransactions("p", ME)).toEqual([fresh]);
    expect(await linkOf(unlinked)).toBeNull();
    // Another plan may still claim it.
    expect(await linkMatchingTransactions("q", ME)).toEqual([unlinked]);
  });
});
