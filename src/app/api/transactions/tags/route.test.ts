import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "bulk-tag-owner";
const EDITOR = "bulk-tag-editor";
const VIEWER = "bulk-tag-viewer";

// Same shape as the transactions route test: the handler only needs the
// caller's id, everything else is real DB work. requireAccountAccess THROWS a
// Response, which the real withUser catches — so this mock must too.
let actor = OWNER;
vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(actor);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("bulk-tags-route");
});
afterAll(async () => {
  await testDb.cleanup();
});

/**
 * Two owners who share nothing but one joint account:
 *   acc-shared   — OWNER's, EDITOR edits it, VIEWER only reads it
 *   acc-private  — OWNER's alone
 *   acc-editor   — EDITOR's own account, which OWNER cannot see
 * and a tag in each owner's space, so "the tag is in the ROW OWNER's space"
 * has something to be wrong about.
 */
beforeEach(async () => {
  actor = OWNER;
  await testDb.reset();
  const now = new Date().toISOString();
  for (const id of [OWNER, EDITOR, VIEWER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@test.dev`, Date.now(), Date.now()],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-shared', ?, 'Joint', 'joint', 'EUR', 0, 0, ?, ?),
                 ('acc-private', ?, 'Private', 'checking', 'EUR', 0, 1, ?, ?),
                 ('acc-editor', ?, 'Theirs', 'checking', 'EUR', 0, 2, ?, ?)`,
    args: [OWNER, now, now, OWNER, now, now, EDITOR, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('am-editor', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?),
                 ('am-viewer', 'acc-shared', ?, 'viewer@test.dev', 'viewer', ?, ?)`,
    args: [EDITOR, now, now, VIEWER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO tags (id, user_id, name, created_at)
          VALUES ('tag-owner', ?, 'holiday', ?), ('tag-editor', ?, 'work', ?)`,
    args: [OWNER, now, EDITOR, now],
  });
});

async function insertTx(id: string, ownerId: string, accountId: string) {
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES (?, ?, ?, '2026-07-15', 'row', -10, 'expense', ?)`,
    args: [id, ownerId, accountId, new Date().toISOString()],
  });
  return id;
}

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/transactions/tags", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

/** The tag ids on a row, straight from the link table. */
async function tagsOn(transactionId: string) {
  const res = await testDb.client.execute({
    sql: `SELECT tag_id FROM transaction_tags WHERE transaction_id = ? ORDER BY tag_id`,
    args: [transactionId],
  });
  return res.rows.map((r) => r.tag_id as string);
}

describe("POST /api/transactions/tags", () => {
  it("puts the tag on every row of the selection", async () => {
    await insertTx("t1", OWNER, "acc-private");
    await insertTx("t2", OWNER, "acc-shared");

    const res = await post({ transactionIds: ["t1", "t2"], tagId: "tag-owner", action: "add" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 2, skipped: 0 });
    expect(await tagsOn("t1")).toEqual(["tag-owner"]);
    expect(await tagsOn("t2")).toEqual(["tag-owner"]);
  });

  it("is a no-op on rows that already carry the tag", async () => {
    await insertTx("t1", OWNER, "acc-private");
    await insertTx("t2", OWNER, "acc-private");
    await post({ transactionIds: ["t1"], tagId: "tag-owner", action: "add" });

    // The overlap must not collide on the unique index — one badge, not two.
    const res = await post({ transactionIds: ["t1", "t2"], tagId: "tag-owner", action: "add" });
    expect(res.status).toBe(200);
    expect(await tagsOn("t1")).toEqual(["tag-owner"]);
    expect(await tagsOn("t2")).toEqual(["tag-owner"]);
  });

  it("takes the tag off the selection and leaves the vocabulary alone", async () => {
    await insertTx("t1", OWNER, "acc-private");
    await insertTx("t2", OWNER, "acc-private");
    await post({ transactionIds: ["t1", "t2"], tagId: "tag-owner", action: "add" });

    const res = await post({ transactionIds: ["t1"], tagId: "tag-owner", action: "remove" });
    expect(await res.json()).toMatchObject({ count: 1 });
    expect(await tagsOn("t1")).toEqual([]);
    expect(await tagsOn("t2")).toEqual(["tag-owner"]);
    const left = await testDb.client.execute(`SELECT id FROM tags WHERE id = 'tag-owner'`);
    expect(left.rows).toHaveLength(1);
  });

  it("refuses a tag the caller cannot see at all", async () => {
    await insertTx("t1", OWNER, "acc-private");

    // EDITOR's own tag, from an account OWNER has no part in.
    const res = await post({ transactionIds: ["t1"], tagId: "tag-editor", action: "add" });
    expect(res.status).toBe(404);
    expect(await tagsOn("t1")).toEqual([]);
  });

  it("skips the rows a visible tag's owner does not own", async () => {
    // EDITOR works across the joint account and their own one, and reaches
    // for OWNER's tag: it belongs on the joint row, and nowhere near theirs.
    actor = EDITOR;
    await insertTx("t-joint", OWNER, "acc-shared");
    await insertTx("t-mine", EDITOR, "acc-editor");

    const res = await post({
      transactionIds: ["t-joint", "t-mine"],
      tagId: "tag-owner",
      action: "add",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 1, skipped: 1 });
    expect(await tagsOn("t-joint")).toEqual(["tag-owner"]);
    expect(await tagsOn("t-mine")).toEqual([]);
  });

  it("writes the link under the ROW OWNER, not the acting member", async () => {
    actor = EDITOR;
    await insertTx("t-joint", OWNER, "acc-shared");

    await post({ transactionIds: ["t-joint"], tagId: "tag-owner", action: "add" });

    // The owner's user_id is what every read above joins on — a link written
    // under EDITOR would be invisible to the row it hangs off.
    const res = await testDb.client.execute(
      `SELECT user_id FROM transaction_tags WHERE transaction_id = 't-joint'`,
    );
    expect(res.rows.map((r) => r.user_id)).toEqual([OWNER]);
  });

  it("gives a viewer nothing to write", async () => {
    actor = VIEWER;
    await insertTx("t-joint", OWNER, "acc-shared");

    // A viewer can see the tag (it is a sharing owner's) but not write the row.
    const res = await post({ transactionIds: ["t-joint"], tagId: "tag-owner", action: "add" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 0, skipped: 1 });
    expect(await tagsOn("t-joint")).toEqual([]);
  });

  it("rejects an empty, oversized or malformed batch", async () => {
    await insertTx("t1", OWNER, "acc-private");

    expect((await post({ transactionIds: [], tagId: "tag-owner", action: "add" })).status).toBe(400);
    expect(
      (
        await post({
          transactionIds: Array.from({ length: 501 }, (_, i) => `x${i}`),
          tagId: "tag-owner",
          action: "add",
        })
      ).status,
    ).toBe(400);
    expect((await post({ transactionIds: ["t1"], tagId: "tag-owner" })).status).toBe(400);
    expect(
      (await post({ transactionIds: ["t1"], tagId: "tag-owner", action: "toggle" })).status,
    ).toBe(400);
    expect((await post({ transactionIds: ["t1"], action: "add" })).status).toBe(400);
  });
});
