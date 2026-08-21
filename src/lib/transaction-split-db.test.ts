import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("transaction-split");

const { db } = await import("@/db");
const { transactions, categories, reimbursementLinks } = await import("@/db/schema");
const { asc, eq, and } = await import("drizzle-orm");
const { applySplit, unsplitTransaction } = await import("@/lib/transaction-split");

const USER = "user-1";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function insertCategory() {
  const id = nextId("cat");
  await db.insert(categories).values({
    id,
    userId: USER,
    name: `Cat ${seq}`,
    createdAt: new Date().toISOString(),
  });
  return id;
}

async function insertTx(overrides: Partial<typeof transactions.$inferInsert> = {}) {
  const id = nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-15",
    description: "Hypotheek",
    amount: -100,
    type: "expense",
    createdAt: new Date().toISOString(),
    ...overrides,
  });
  return id;
}

const split = (parentId: string, splits: { amount: number; categoryId?: string | null }[]) =>
  applySplit({ parentId, ownerId: USER, actorId: USER, splits, source: "manual" });

async function children(parentId: string) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.parentTransactionId, parentId));
}

async function parentRow(parentId: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, parentId));
  return row;
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("applySplit", () => {
  it("creates children, flags and uncategorizes the parent", async () => {
    const cat = await insertCategory();
    const id = await insertTx({ categoryId: cat, categorySource: "manual" });
    const res = await split(id, [
      { amount: -40, categoryId: cat },
      { amount: -60 },
    ]);
    expect(res.ok).toBe(true);

    const parent = await parentRow(id);
    expect(parent.isSplitParent).toBe(true);
    expect(parent.categoryId).toBeNull();
    expect(parent.amount).toBe(-100);

    const kids = await children(id);
    expect(kids).toHaveLength(2);
    expect(kids.map((k) => k.amount).sort((a, b) => a - b)).toEqual([-60, -40]);
    expect(kids.every((k) => k.type === "expense" && k.date === "2026-07-15")).toBe(true);
    expect(kids.find((k) => k.amount === -40)?.categorySource).toBe("manual");
  });

  it("rejects sums that do not match the parent amount", async () => {
    const id = await insertTx();
    const res = await split(id, [{ amount: -40 }, { amount: -70 }]);
    expect(res).toMatchObject({ ok: false, error: "api.splitSumMismatch" });
    expect(await children(id)).toHaveLength(0);
  });

  it("rejects wrong-sign amounts, fewer than 2 parts, and non-expense/income types", async () => {
    const id = await insertTx();
    expect(await split(id, [{ amount: -40 }, { amount: 60 }])).toMatchObject({
      ok: false,
      error: "api.splitInvalidAmount",
    });
    expect(await split(id, [{ amount: -100 }])).toMatchObject({
      ok: false,
      error: "api.splitTooFew",
    });
    const transfer = await insertTx({ type: "internal_transfer" });
    expect(await split(transfer, [{ amount: -40 }, { amount: -60 }])).toMatchObject({
      ok: false,
      error: "api.splitWrongType",
    });
  });

  it("rejects splitting a transaction in a pot or reimbursement-linked", async () => {
    const potted = await insertTx({ groupId: "pot-1" });
    expect(await split(potted, [{ amount: -40 }, { amount: -60 }])).toMatchObject({
      ok: false,
      error: "api.splitParentInPot",
    });

    const expense = await insertTx();
    const reimb = await insertTx({ amount: 20, type: "reimbursement" });
    await db.insert(reimbursementLinks).values({
      id: nextId("rl"),
      reimbursementId: reimb,
      expenseId: expense,
      createdAt: new Date().toISOString(),
    });
    expect(await split(expense, [{ amount: -40 }, { amount: -60 }])).toMatchObject({
      ok: false,
      error: "api.splitParentReimbursed",
    });
  });

  it("rejects splitting a split child, and categories of another user", async () => {
    const id = await insertTx();
    await split(id, [{ amount: -40 }, { amount: -60 }]);
    const [child] = await children(id);
    expect(await split(child.id, [{ amount: -20 }, { amount: -20 }])).toMatchObject({
      ok: false,
      error: "api.splitNested",
    });

    const foreignCat = nextId("cat");
    await db.insert(categories).values({
      id: foreignCat,
      userId: "someone-else",
      name: "Foreign",
      createdAt: new Date().toISOString(),
    });
    const other = await insertTx();
    expect(
      await split(other, [{ amount: -40, categoryId: foreignCat }, { amount: -60 }]),
    ).toMatchObject({ ok: false, error: "api.splitInvalidCategory" });
  });

  it("replaces existing splits on re-split", async () => {
    const id = await insertTx();
    await split(id, [{ amount: -40 }, { amount: -60 }]);
    const res = await split(id, [{ amount: -10 }, { amount: -20 }, { amount: -70 }]);
    expect(res.ok).toBe(true);
    const kids = await children(id);
    expect(kids).toHaveLength(3);
  });

  it("blocks re-split and unsplit while a child is in a pot", async () => {
    const id = await insertTx();
    await split(id, [{ amount: -40 }, { amount: -60 }]);
    const [child] = await children(id);
    await db
      .update(transactions)
      .set({ groupId: "pot-1" })
      .where(and(eq(transactions.id, child.id), eq(transactions.userId, USER)));

    expect(await split(id, [{ amount: -50 }, { amount: -50 }])).toMatchObject({
      ok: false,
      error: "api.splitChildLinked",
    });
    expect(
      await unsplitTransaction({ parentId: id, ownerId: USER, actorId: USER }),
    ).toMatchObject({ ok: false, error: "api.splitChildLinked" });
  });

  it("inherits the parent's recurring link on children", async () => {
    const id = await insertTx({ recurringTransactionId: "rec-1" });
    await split(id, [{ amount: -40 }, { amount: -60 }]);
    const kids = await children(id);
    expect(kids.every((k) => k.recurringTransactionId === "rec-1")).toBe(true);
  });

  // The list sorts children by (created_at, id). Left on the column default
  // every child of a split shares one millisecond, so the random-uuid tiebreak
  // decided the order — and the editor's LAST row is what becomes a split
  // rule's remainder line, so a shuffle put the remainder on the wrong
  // category. Assert the order the list actually reads, not just the set.
  it("returns children in submission order, not uuid order", async () => {
    const id = await insertTx({ amount: -300 });
    await split(id, [{ amount: -10 }, { amount: -90 }, { amount: -200 }]);
    const ordered = await db
      .select()
      .from(transactions)
      .where(eq(transactions.parentTransactionId, id))
      .orderBy(asc(transactions.createdAt), asc(transactions.id));
    expect(ordered.map((k) => k.amount)).toEqual([-10, -90, -200]);
  });

  it("keeps submission order on re-split too", async () => {
    const id = await insertTx({ amount: -300 });
    await split(id, [{ amount: -150 }, { amount: -150 }]);
    await split(id, [{ amount: -200 }, { amount: -10 }, { amount: -90 }]);
    const ordered = await db
      .select()
      .from(transactions)
      .where(eq(transactions.parentTransactionId, id))
      .orderBy(asc(transactions.createdAt), asc(transactions.id));
    expect(ordered.map((k) => k.amount)).toEqual([-200, -10, -90]);
  });
});

describe("unsplitTransaction", () => {
  it("removes children and restores the parent", async () => {
    const id = await insertTx();
    await split(id, [{ amount: -40 }, { amount: -60 }]);
    const res = await unsplitTransaction({ parentId: id, ownerId: USER, actorId: USER });
    expect(res.ok).toBe(true);
    expect(await children(id)).toHaveLength(0);
    expect((await parentRow(id)).isSplitParent).toBe(false);
  });

  it("rejects unsplitting a transaction that is not split", async () => {
    const id = await insertTx();
    expect(
      await unsplitTransaction({ parentId: id, ownerId: USER, actorId: USER }),
    ).toMatchObject({ ok: false, error: "api.splitNotSplit" });
  });
});

// ─── Edge and negative cases ─────────────────────────────────────────────────
// The account OWNER is whose user_id every row keeps; ACTOR is an editor on a
// shared account doing the splitting (shared-accounts model). OTHER owns
// nothing here and exercises the cross-tenant guards.
const ACTOR = "editor-1";
const OTHER = "someone-else";

const splitAs = (
  parentId: string,
  splits: { amount: number; categoryId?: string | null; description?: string | null; notes?: string | null }[],
  over: Partial<Parameters<typeof applySplit>[0]> = {},
) =>
  applySplit({ parentId, ownerId: USER, actorId: ACTOR, splits, source: "manual", ...over });

const rowCount = async () =>
  Number(
    (await testDb.client.execute("SELECT COUNT(*) AS n FROM transactions")).rows[0].n,
  );

const TWO = [{ amount: -40 }, { amount: -60 }];

describe("applySplit — refusals, edge cases", () => {
  it("404s on an unknown id", async () => {
    expect(await splitAs("no-such-tx", TWO)).toEqual({
      ok: false,
      error: "api.transactionNotFound",
      status: 404,
    });
  });

  it("404s (not 403) on another owner's row — existence stays hidden", async () => {
    const id = await insertTx();
    expect(await splitAs(id, TWO, { ownerId: OTHER })).toMatchObject({
      error: "api.transactionNotFound",
      status: 404,
    });
    expect((await parentRow(id)).isSplitParent).toBe(false);
  });

  it("refuses a reimbursement-linked row from the reimbursement side too", async () => {
    // The guard checks both columns of the link — a row can be either leg.
    const reimb = await insertTx({ amount: 20, type: "income" });
    const expense = await insertTx();
    await db.insert(reimbursementLinks).values({
      id: nextId("rl"),
      reimbursementId: reimb,
      expenseId: expense,
      createdAt: new Date().toISOString(),
    });
    expect(await splitAs(reimb, [{ amount: 8 }, { amount: 12 }])).toMatchObject({
      error: "api.splitParentReimbursed",
      status: 409,
    });
  });

  it("refuses a row that reimburses another transaction", async () => {
    const expense = await insertTx();
    const id = await insertTx({ reimbursesTransactionId: expense });
    expect(await splitAs(id, TWO)).toMatchObject({
      error: "api.splitParentReimbursed",
      status: 409,
    });
  });

  it("refuses an empty parts list", async () => {
    const id = await insertTx();
    expect(await splitAs(id, [])).toMatchObject({
      error: "api.splitTooFew",
      status: 400,
    });
  });

  it("caps a split at 20 parts, inclusive", async () => {
    const id = await insertTx();
    const parts = (n: number) => Array.from({ length: n }, () => ({ amount: -100 / n }));
    expect(await splitAs(id, parts(21))).toMatchObject({
      error: "api.splitTooMany",
      status: 400,
    });
    expect((await splitAs(id, parts(20))).ok).toBe(true);
    expect(await children(id)).toHaveLength(20);
  });

  it.each([
    ["zero", 0],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])("refuses an amount of %s", async (_label, bad) => {
    const id = await insertTx();
    expect(await splitAs(id, [{ amount: bad }, { amount: -100 }])).toMatchObject({
      error: "api.splitInvalidAmount",
      status: 400,
    });
  });

  it.each([
    ["a numeric string", "40"],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s as an amount — the field is never coerced", async (_label, bad) => {
    const id = await insertTx();
    expect(
      await splitAs(id, [{ amount: bad as unknown as number }, { amount: -60 }]),
    ).toMatchObject({ error: "api.splitInvalidAmount", status: 400 });
  });

  it("compares the sum against MONEY_EPSILON rather than exactly", async () => {
    // Half a cent is the tolerance: 0.004 off passes, 0.006 off does not.
    const near = await insertTx();
    expect((await splitAs(near, [{ amount: -50 }, { amount: -50.004 }])).ok).toBe(true);
    const far = await insertTx();
    expect(await splitAs(far, [{ amount: -50 }, { amount: -50.006 }])).toMatchObject({
      error: "api.splitSumMismatch",
      status: 400,
    });
  });

  it("tolerates binary float noise in an otherwise exact split", async () => {
    // -0.1 * 3 sums to -0.30000000000000004 in IEEE-754; an exact compare
    // would reject a split the user entered correctly.
    const id = await insertTx({ amount: -0.3 });
    expect(
      (await splitAs(id, [{ amount: -0.1 }, { amount: -0.1 }, { amount: -0.1 }])).ok,
    ).toBe(true);
  });

  it("can never split a zero-amount row — no same-sign parts add up to 0", async () => {
    const id = await insertTx({ amount: 0 });
    expect(await splitAs(id, [{ amount: 1 }, { amount: -1 }])).toMatchObject({
      error: "api.splitInvalidAmount",
    });
    expect(await splitAs(id, [{ amount: 1 }, { amount: 1 }])).toMatchObject({
      error: "api.splitSumMismatch",
    });
  });

  it("refuses a category id that does not exist at all", async () => {
    const id = await insertTx();
    expect(
      await splitAs(id, [{ amount: -40, categoryId: "cat-ghost" }, { amount: -60 }]),
    ).toMatchObject({ error: "api.splitInvalidCategory", status: 400 });
  });

  it("writes nothing at all when a guard trips", async () => {
    const id = await insertTx({ categoryId: null });
    const before = await rowCount();
    await splitAs(id, [{ amount: -40 }, { amount: -70 }]); // sum mismatch
    expect(await rowCount()).toBe(before);
    const parent = await parentRow(id);
    expect(parent.isSplitParent).toBe(false);
    expect(parent.amount).toBe(-100);
  });
});

describe("applySplit — what the children carry", () => {
  it("keeps the OWNER's user_id on children while crediting the acting editor", async () => {
    const id = await insertTx();
    await splitAs(id, TWO);
    for (const kid of await children(id)) {
      expect(kid.userId).toBe(USER); // never rewritten to the actor
      expect(kid.createdBy).toBe(ACTOR);
    }
  });

  it("inherits identity from the parent and carries no balance of its own", async () => {
    const id = await insertTx({
      name: "HYPOTHEEK",
      isManual: true,
      importBatchId: "batch-7",
      balance: 42,
    });
    await splitAs(id, TWO);

    for (const kid of await children(id)) {
      expect(kid.accountId).toBe("acct-1");
      expect(kid.name).toBe("HYPOTHEEK");
      expect(kid.isManual).toBe(true);
      expect(kid.importBatchId).toBe("batch-7");
      // Only the parent is the real bank row, so only it keeps a balance.
      expect(kid.balance).toBeNull();
      expect(kid.isSplitParent).toBe(false);
      expect(kid.parentTransactionId).toBe(id);
    }
  });

  it("clears the parent's stale category label and stamps who changed it", async () => {
    const cat = await insertCategory();
    const id = await insertTx({
      categoryId: cat,
      categorySource: "manual",
      categoryLabel: "Old label",
    });
    await splitAs(id, TWO);
    const parent = await parentRow(id);
    expect(parent.categoryLabel).toBeNull();
    expect(parent.categorySource).toBeNull();
    expect(parent.modifiedBy).toBe(ACTOR);
  });

  it("splits income with positive parts", async () => {
    const id = await insertTx({ amount: 2500, type: "income" });
    expect((await splitAs(id, [{ amount: 1000 }, { amount: 1500 }])).ok).toBe(true);
    const kids = await children(id);
    expect(kids.every((k) => k.type === "income")).toBe(true);
    expect(kids.reduce((s, k) => s + k.amount, 0)).toBeCloseTo(2500, 6);
  });

  it("stamps categorySource from the caller and leaves it null on an uncategorised part", async () => {
    const cat = await insertCategory();
    const id = await insertTx();
    await splitAs(id, [{ amount: -40, categoryId: cat }, { amount: -60 }], {
      source: "rule",
    });
    const kids = await children(id);
    expect(kids.find((k) => k.amount === -40)?.categorySource).toBe("rule");
    expect(kids.find((k) => k.amount === -60)?.categorySource).toBeNull();
  });

  it("falls back to the parent description when a part gives none or only blanks", async () => {
    const id = await insertTx();
    await splitAs(id, [
      { amount: -40, description: "  Beer  " },
      { amount: -30, description: "   " },
      { amount: -30, description: null },
    ]);
    const kids = await children(id);
    expect(kids.find((k) => k.amount === -40)?.description).toBe("Beer");
    // Both the whitespace-only and the missing one inherit "Hypotheek".
    expect(kids.filter((k) => k.description === "Hypotheek")).toHaveLength(2);
  });

  it("sanitises notes — trimmed, capped at 500, blank becomes null", async () => {
    const id = await insertTx();
    await splitAs(id, [
      { amount: -40, notes: "  keep me  " },
      { amount: -30, notes: "   " },
      { amount: -30, notes: "x".repeat(600) },
    ]);
    const kids = await children(id);
    expect(kids.find((k) => k.amount === -40)?.notes).toBe("keep me");
    expect(kids.find((k) => k.notes === null)).toBeDefined();
    expect(kids.find((k) => k.amount === -30 && k.notes)?.notes).toHaveLength(500);
  });
});

describe("applySplit — re-split, edge cases", () => {
  it("deletes the old parts rather than orphaning them", async () => {
    const id = await insertTx();
    await splitAs(id, TWO);
    const firstIds = (await children(id)).map((k) => k.id);

    await splitAs(id, [{ amount: -25 }, { amount: -25 }, { amount: -50 }]);
    const kids = await children(id);
    expect(kids.some((k) => firstIds.includes(k.id))).toBe(false);
    expect(await rowCount()).toBe(4); // parent + 3, nothing left behind
  });

  it("refuses while a part is reimbursement-linked, keeping the existing split", async () => {
    const id = await insertTx();
    await splitAs(id, TWO);
    const [child] = await children(id);
    const reimb = await insertTx({ amount: 40, type: "income" });
    await db.insert(reimbursementLinks).values({
      id: nextId("rl"),
      reimbursementId: reimb,
      expenseId: child.id,
      createdAt: new Date().toISOString(),
    });

    expect(await splitAs(id, [{ amount: -50 }, { amount: -50 }])).toMatchObject({
      error: "api.splitChildLinked",
      status: 409,
    });
    expect((await children(id)).map((k) => k.amount).sort((a, b) => a - b)).toEqual([
      -60, -40,
    ]);
  });

  it("ignores pot links on ANOTHER transaction's children", async () => {
    const mine = await insertTx();
    await splitAs(mine, TWO);
    // An unrelated split with a potted child must not block this one.
    const other = await insertTx({ amount: -20 });
    await splitAs(other, [{ amount: -5 }, { amount: -15 }]);
    const [otherChild] = await children(other);
    await db
      .update(transactions)
      .set({ groupId: "pot-1" })
      .where(and(eq(transactions.id, otherChild.id), eq(transactions.userId, USER)));

    expect((await splitAs(mine, [{ amount: -30 }, { amount: -70 }])).ok).toBe(true);
    expect(await children(other)).toHaveLength(2); // untouched
  });
});

describe("unsplitTransaction — edge cases", () => {
  const unsplit = (parentId: string, over = {}) =>
    unsplitTransaction({ parentId, ownerId: USER, actorId: ACTOR, ...over });

  it("404s on an unknown id and on another owner's row, removing nothing", async () => {
    const id = await insertTx();
    await splitAs(id, TWO);
    expect(await unsplit("no-such-tx")).toMatchObject({ status: 404 });
    expect(await unsplit(id, { ownerId: OTHER })).toMatchObject({
      error: "api.transactionNotFound",
      status: 404,
    });
    expect(await children(id)).toHaveLength(2);
  });

  it("restores the wrapper to a normal uncategorised row and stamps the actor", async () => {
    const cat = await insertCategory();
    const id = await insertTx({ categoryId: cat });
    await splitAs(id, [{ amount: -40, categoryId: cat }, { amount: -60 }]);
    expect(await unsplit(id)).toEqual({ ok: true });

    const parent = await parentRow(id);
    expect(parent.isSplitParent).toBe(false);
    expect(parent.modifiedBy).toBe(ACTOR);
    expect(parent.amount).toBe(-100);
    // The categories lived on the parts; the wrapper comes back uncategorised.
    expect(parent.categoryId).toBeNull();
    expect(await rowCount()).toBe(1);
  });

  it("reports notSplit on a second unsplit instead of deleting again", async () => {
    const id = await insertTx();
    await splitAs(id, TWO);
    expect(await unsplit(id)).toEqual({ ok: true });
    expect(await unsplit(id)).toMatchObject({ error: "api.splitNotSplit" });
  });
});
