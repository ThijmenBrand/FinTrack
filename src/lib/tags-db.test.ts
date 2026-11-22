import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("tags");

const { db } = await import("@/db");
const { transactions, tags, transactionTags } = await import("@/db/schema");
const { and, eq, or } = await import("drizzle-orm");
const {
  hasAnyTag,
  parentHasChildWithTags,
  childHasParentWithTags,
  tagsForTransactions,
  clearTransactionTags,
} = await import("@/lib/tags-db");

const USER = "user-1";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function insertTx(opts: { parentId?: string; isSplitParent?: boolean } = {}) {
  const id = nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-15",
    description: "t",
    amount: -10,
    type: "expense",
    parentTransactionId: opts.parentId ?? null,
    isSplitParent: opts.isSplitParent ?? false,
  });
  return id;
}

async function insertTag(name: string) {
  const id = nextId("tag");
  await db.insert(tags).values({ id, userId: USER, name });
  return id;
}

async function tag(transactionId: string, tagId: string) {
  await db.insert(transactionTags).values({ userId: USER, transactionId, tagId });
}

/** Every row a `tag:` filter matches — what the list and the totals both
 *  narrow down from, exactly as /api/transactions builds it. */
async function filterByTags(tagIds: string[]) {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, USER),
        or(hasAnyTag(tagIds), parentHasChildWithTags(tagIds), childHasParentWithTags(tagIds))!,
      ),
    );
  return rows.map((r) => r.id).sort();
}

beforeEach(async () => {
  await testDb.reset();
  seq = 0;
  // tags.user_id and transaction_tags.* carry real foreign keys (the tables
  // come from the migration, not from test-db's hand-written DDL), and the
  // test file enforces them.
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
    args: [USER, USER, `${USER}@test.dev`],
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("tag filtering", () => {
  it("keeps only the rows carrying one of the tags", async () => {
    const holiday = await insertTag("holiday");
    const work = await insertTag("work");
    const tagged = await insertTx();
    const otherTagged = await insertTx();
    const untagged = await insertTx();
    await tag(tagged, holiday);
    await tag(otherTagged, work);

    expect(await filterByTags([holiday])).toEqual([tagged]);
    expect(await filterByTags([holiday, work])).toEqual([otherTagged, tagged].sort());
    expect(await filterByTags([holiday])).not.toContain(untagged);
  });

  it("returns a row carrying several of the filtered tags exactly once", async () => {
    const holiday = await insertTag("holiday");
    const work = await insertTag("work");
    const both = await insertTx();
    await tag(both, holiday);
    await tag(both, work);

    // A join would have duplicated this row — and with it every total the
    // page sums over the same WHERE clause.
    expect(await filterByTags([holiday, work])).toEqual([both]);
  });

  it("surfaces a split parent when a hidden child carries the tag", async () => {
    const holiday = await insertTag("holiday");
    const parent = await insertTx({ isSplitParent: true });
    const child = await insertTx({ parentId: parent });
    await tag(child, holiday);

    // The parent is the row the list shows; the child rides along under it.
    expect(await filterByTags([holiday])).toEqual([child, parent].sort());
  });

  it("counts the parts of a split whose wrapper carries the tag", async () => {
    const holiday = await insertTag("holiday");
    const parent = await insertTx({ isSplitParent: true });
    const firstPart = await insertTx({ parentId: parent });
    const secondPart = await insertTx({ parentId: parent });
    await tag(parent, holiday);

    // The wrapper is the row the list shows, but it is excluded from every
    // total — so its parts have to match too, or the page lists a family and
    // totals it to nothing.
    expect(await filterByTags([holiday])).toEqual([firstPart, parent, secondPart].sort());
  });

  it("does not surface an unrelated row as a split parent", async () => {
    const holiday = await insertTag("holiday");
    const parent = await insertTx({ isSplitParent: true });
    await insertTx({ parentId: parent });
    const elsewhere = await insertTx();
    await tag(elsewhere, holiday);

    expect(await filterByTags([holiday])).toEqual([elsewhere]);
  });
});

describe("tagsForTransactions", () => {
  it("groups tags by transaction, alphabetically, and skips untagged rows", async () => {
    const work = await insertTag("work");
    const admin = await insertTag("admin");
    const first = await insertTx();
    const second = await insertTx();
    const untagged = await insertTx();
    await tag(first, work);
    await tag(first, admin);
    await tag(second, work);

    const byTx = await tagsForTransactions(USER, [first, second, untagged]);
    expect(byTx.get(first)?.map((t) => t.name)).toEqual(["admin", "work"]);
    expect(byTx.get(second)?.map((t) => t.name)).toEqual(["work"]);
    expect(byTx.has(untagged)).toBe(false);
  });

  it("asks nothing of the database for an empty page", async () => {
    expect((await tagsForTransactions(USER, [])).size).toBe(0);
  });
});

describe("clearTransactionTags", () => {
  it("drops the links of the named rows and leaves the rest alone", async () => {
    const holiday = await insertTag("holiday");
    const doomed = await insertTx();
    const kept = await insertTx();
    await tag(doomed, holiday);
    await tag(kept, holiday);

    await clearTransactionTags(db, [doomed], [USER]);

    const left = await db
      .select({ transactionId: transactionTags.transactionId })
      .from(transactionTags)
      .where(eq(transactionTags.userId, USER));
    expect(left.map((r) => r.transactionId)).toEqual([kept]);
    // The tag itself survives losing its last row of that name.
    const vocabulary = await db.select({ id: tags.id }).from(tags).where(eq(tags.userId, USER));
    expect(vocabulary).toHaveLength(1);
  });

  it("ignores a row belonging to another owner", async () => {
    const holiday = await insertTag("holiday");
    const row = await insertTx();
    await tag(row, holiday);

    await clearTransactionTags(db, [row], ["someone-else"]);

    const left = await db
      .select({ transactionId: transactionTags.transactionId })
      .from(transactionTags)
      .where(eq(transactionTags.userId, USER));
    expect(left).toHaveLength(1);
  });
});
