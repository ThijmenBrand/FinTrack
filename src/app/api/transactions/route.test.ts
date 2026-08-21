import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "tx-route-owner";
const EDITOR = "tx-route-editor";
const VIEWER = "tx-route-viewer";

// The route only needs the caller's id; everything else is real DB work.
// `actor` is mutable so each test can act as a different member. Mirrors the
// real withUser: requireAccountAccess THROWS a Response for 403/404, which
// the real wrapper catches — this mock must too, or the throw surfaces as an
// unhandled rejection instead of a normal response.
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
  testDb = await setupTestDb("transactions-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
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
                 ('acc-private', ?, 'Private', 'checking', 'EUR', 0, 1, ?, ?)`,
    args: [OWNER, now, now, OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-owner', ?, 'Groceries', ?)`,
    args: [OWNER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-editor', ?, 'Fun', ?)`,
    args: [EDITOR, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('am-editor', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?),
                 ('am-viewer', 'acc-shared', ?, 'viewer@test.dev', 'viewer', ?, ?)`,
    args: [EDITOR, now, now, VIEWER, now, now],
  });
});

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/transactions", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const get = (query: string) =>
  import("./route").then(({ GET }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    GET(new Request(`http://x/api/transactions?${query}`) as any),
  );

describe("GET /api/transactions — category filter", () => {
  // A pot's category lives on the pot, not on its members: budgets and insights
  // book the pot's whole net under it, so filtering this endpoint on that
  // category must find the pot too or the two screens disagree.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transaction_groups (id, user_id, name, category_id, created_at)
            VALUES ('pot-1', ?, 'ULV', 'cat-owner', ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, group_id, created_at)
            VALUES ('tx-direct', ?, 'acc-private', '2026-08-09', 'Bar', -20, 'expense', 'cat-owner', NULL, ?),
                   ('tx-potted', ?, 'acc-private', '2026-08-10', 'Pot member', -30, 'expense', NULL, 'pot-1', ?),
                   ('tx-other', ?, 'acc-private', '2026-08-11', 'Unrelated', -99, 'expense', NULL, NULL, ?)`,
      args: [OWNER, now, OWNER, now, OWNER, now],
    });
  });

  it("counts a pot's net under the pot's own category, even when its members are uncategorised", async () => {
    const body = await (await get("categoryId=cat-owner")).json();
    expect(body.totals.expense).toBeCloseTo(-50, 2); // direct 20 + pot net 30
    expect(body.potTotals).toHaveLength(1);
    expect(body.data.map((r: { id: string }) => r.id).sort()).toEqual([
      "tx-direct",
      "tx-potted",
    ]);
  });

  it("still leaves rows outside the category alone", async () => {
    const body = await (await get("categoryId=cat-editor")).json();
    expect(body.pagination.total).toBe(0);
    expect(body.totals.expense).toBeCloseTo(0, 2);
  });
});

describe("GET /api/transactions — split parents", () => {
  // A split parent is a pure money wrapper: its children carry the real
  // categories and count in totals; the parent itself must never show as a
  // top-level row (its children ride along under it) or count in totals.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, is_split_parent, created_at)
            VALUES ('tx-parent', ?, 'acc-private', '2026-08-12', 'Big shop', -100, 'expense', NULL, 1, ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, parent_transaction_id, created_at)
            VALUES ('tx-child-a', ?, 'acc-private', '2026-08-12', 'Groceries part', -40, 'expense', 'cat-owner', 'tx-parent', ?),
                   ('tx-child-b', ?, 'acc-private', '2026-08-12', 'Other part', -60, 'expense', NULL, 'tx-parent', ?)`,
      args: [OWNER, now, OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, created_at)
            VALUES ('tx-normal', ?, 'acc-private', '2026-08-13', 'Unrelated', -10, 'expense', NULL, ?)`,
      args: [OWNER, now],
    });
  });

  it("hides children from the top-level list and attaches them as splits on the parent", async () => {
    const body = await (await get("accountId=acc-private")).json();
    expect(body.pagination.total).toBe(2);
    const ids = body.data.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual(["tx-normal", "tx-parent"]);

    const parent = body.data.find((r: { id: string }) => r.id === "tx-parent");
    expect(parent.splits.map((s: { id: string }) => s.id).sort()).toEqual([
      "tx-child-a",
      "tx-child-b",
    ]);
  });

  it("totals count the children and exclude the parent wrapper", async () => {
    const body = await (await get("accountId=acc-private")).json();
    // 40 + 60 (children) + 10 (normal) — the -100 parent is not double-counted.
    expect(body.totals.expense).toBeCloseTo(-110, 2);
  });

  it("a category filter matching only a hidden child still surfaces the parent, with every child still attached", async () => {
    const body = await (await get("accountId=acc-private&categoryId=cat-owner")).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["tx-parent"]);
    const parent = body.data[0];
    // Splits are never filtered server-side — the UI highlights the match.
    expect(parent.splits.map((s: { id: string }) => s.id).sort()).toEqual([
      "tx-child-a",
      "tx-child-b",
    ]);
  });

  it("a search term matching only a hidden child's description surfaces the parent, and totals still count that child", async () => {
    // 'tx-child-a' is the only row whose description contains "Groceries" —
    // not the parent ("Big shop") nor its sibling ("Other part"). Before the
    // fix the list came back empty while totals still showed the -40.
    const body = await (await get("accountId=acc-private&search=Groceries")).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["tx-parent"]);
    expect(body.data[0].splits.map((s: { id: string }) => s.id).sort()).toEqual([
      "tx-child-a",
      "tx-child-b",
    ]);
    expect(body.totals.expense).toBeCloseTo(-40, 2);
  });

  it("an amount search matching only the parent's total pulls every child into the totals", async () => {
    // A 30/20 split of a -50 parent: neither child's own amount is "50", only
    // the parent's total is. The list already showed the parent (it matches
    // directly); the bug was totals coming back €0 instead of -50.
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, created_at)
            VALUES ('tx-parent2', ?, 'acc-private', '2026-08-14', 'Big trip', -50, 'expense', 1, ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, parent_transaction_id, created_at)
            VALUES ('tx-child-c', ?, 'acc-private', '2026-08-14', 'Flight', -30, 'expense', 'tx-parent2', ?),
                   ('tx-child-d', ?, 'acc-private', '2026-08-14', 'Hotel', -20, 'expense', 'tx-parent2', ?)`,
      args: [OWNER, now, OWNER, now],
    });

    const body = await (await get("accountId=acc-private&search=50")).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["tx-parent2"]);
    expect(body.totals.expense).toBeCloseTo(-50, 2);
  });

  it("keeps a parent's splits in the order they were created, not by amount", async () => {
    // Parts written biggest-first, the way a 70/30 rule's sortOrder would.
    // Ordering by amount instead would reverse them, since expense amounts are
    // negative and -30 sorts above -70.
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, created_at)
            VALUES ('tx-parent3', ?, 'acc-private', '2026-08-15', 'Mortgage', -100, 'expense', 1, '2026-08-15T10:00:00.000Z')`,
      args: [OWNER],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, parent_transaction_id, created_at)
            VALUES ('tx-child-interest', ?, 'acc-private', '2026-08-15', 'Interest', -70, 'expense', 'tx-parent3', '2026-08-15T10:00:01.000Z'),
                   ('tx-child-capital', ?, 'acc-private', '2026-08-15', 'Capital', -30, 'expense', 'tx-parent3', '2026-08-15T10:00:02.000Z')`,
      args: [OWNER, OWNER],
    });

    const body = await (await get("accountId=acc-private&search=Mortgage")).json();
    const parent = body.data.find((r: { id: string }) => r.id === "tx-parent3");
    expect(parent.splits.map((s: { id: string }) => s.id)).toEqual([
      "tx-child-interest",
      "tx-child-capital",
    ]);
  });

  it("uncategorized=true skips a fully-categorized parent, whose own NULL category is just the split wrapper", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, is_split_parent, created_at)
            VALUES ('tx-parent-done', ?, 'acc-private', '2026-08-16', 'Jumbo', -38.99, 'expense', NULL, 1, ?)`,
      args: [OWNER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, parent_transaction_id, created_at)
            VALUES ('tx-done-a', ?, 'acc-private', '2026-08-16', 'Groceries', -10, 'expense', 'cat-owner', 'tx-parent-done', ?),
                   ('tx-done-b', ?, 'acc-private', '2026-08-16', 'Dining', -28.99, 'expense', 'cat-owner', 'tx-parent-done', ?)`,
      args: [OWNER, now, OWNER, now],
    });

    const body = await (await get("accountId=acc-private&uncategorized=true")).json();
    const ids = body.data.map((r: { id: string }) => r.id).sort();
    // tx-parent still qualifies — its tx-child-b has no category.
    expect(ids).toEqual(["tx-normal", "tx-parent"]);
  });

  it("nearDate/nearAmount (the reimbursement picker) offers split children as candidate rows and hides the parent wrapper", async () => {
    const body = await (
      await get("accountId=acc-private&nearDate=2026-08-12&nearAmount=40")
    ).json();
    const ids = body.data.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["tx-child-a", "tx-child-b", "tx-normal"]));
    expect(ids).not.toContain("tx-parent");
  });
});

describe("GET /api/transactions — createdBySelf", () => {
  // The list hides the "added by" byline on your own rows; NULL created_by
  // means the account owner, so the owner must see their own rows as self.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_by, created_at)
            VALUES ('tx-mine', ?, 'acc-shared', '2026-08-09', 'Mine', -20, 'expense', NULL, ?),
                   ('tx-theirs', ?, 'acc-shared', '2026-08-10', 'Theirs', -30, 'expense', ?, ?)`,
      args: [OWNER, now, OWNER, EDITOR, now],
    });
  });

  it("flags rows the caller created, from either side of the share", async () => {
    const flags = async (who: string) => {
      actor = who;
      const body = await (await get("accountId=acc-shared")).json();
      return Object.fromEntries(
        body.data.map((r: { id: string; createdBySelf: boolean }) => [r.id, r.createdBySelf]),
      );
    };
    expect(await flags(OWNER)).toEqual({ "tx-mine": true, "tx-theirs": false });
    expect(await flags(EDITOR)).toEqual({ "tx-mine": false, "tx-theirs": true });
  });
});

describe("POST /api/transactions", () => {
  it("an editor creates a transaction on a shared account: row keeps the OWNER's userId, attributes createdBy to the editor, and validates the category in the OWNER's space", async () => {
    actor = EDITOR;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Groceries run",
      amount: -42,
      type: "expense",
      categoryId: "cat-owner",
    });
    expect(res.status).toBe(201);
    const created = await res.json();

    const row = (
      await testDb.client.execute({
        sql: `SELECT user_id, created_by, category_id FROM transactions WHERE id = ?`,
        args: [created.id],
      })
    ).rows[0];
    expect(row.user_id).toBe(OWNER);
    expect(row.created_by).toBe(EDITOR);
    expect(row.category_id).toBe("cat-owner");
  });

  it("rejects a category from the editor's own space — only the account owner's categories are valid there", async () => {
    actor = EDITOR;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Groceries run",
      amount: -42,
      type: "expense",
      categoryId: "cat-editor",
    });
    expect(res.status).toBe(404);
  });

  it("a viewer cannot create a transaction (403)", async () => {
    actor = VIEWER;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Nope",
      amount: -10,
      type: "expense",
    });
    expect(res.status).toBe(403);
  });

  it("a member cannot write to an unshared account (404, existence hidden)", async () => {
    actor = EDITOR;
    const res = await post({
      accountId: "acc-private",
      date: "2026-08-01",
      description: "Nope",
      amount: -10,
      type: "expense",
    });
    expect(res.status).toBe(404);
  });

  it("the owner posting to their own account works as before", async () => {
    actor = OWNER;
    const res = await post({
      accountId: "acc-shared",
      date: "2026-08-01",
      description: "Rent",
      amount: -900,
      type: "expense",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    const row = (
      await testDb.client.execute({
        sql: `SELECT user_id, created_by FROM transactions WHERE id = ?`,
        args: [created.id],
      })
    ).rows[0];
    expect(row.user_id).toBe(OWNER);
    expect(row.created_by).toBe(OWNER);
  });
});

const del = (query: string) =>
  import("./route").then(({ DELETE }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DELETE(new Request(`http://x/api/transactions?${query}`, { method: "DELETE" }) as any),
  );

describe("DELETE /api/transactions — batch", () => {
  // 'tx-a'/'tx-b' are plain rows; 'tx-linked' is a shared-account leg paired
  // with the private 'tx-transfer' the batch deletes.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_manual, linked_transaction_id, category_id, created_at)
            VALUES ('tx-a', ?, 'acc-private', '2026-08-01', 'A', -10, 'expense', 0, NULL, NULL, ?),
                   ('tx-b', ?, 'acc-private', '2026-08-02', 'B', -20, 'expense', 0, NULL, NULL, ?),
                   ('tx-transfer', ?, 'acc-private', '2026-08-03', 'Out', -50, 'internal_transfer', 0, 'tx-linked', NULL, ?),
                   ('tx-linked', ?, 'acc-shared', '2026-08-03', 'In', 50, 'internal_transfer', 0, 'tx-transfer', 'cat-owner', ?),
                   ('tx-keep', ?, 'acc-private', '2026-08-04', 'Keep', -5, 'expense', 0, NULL, NULL, ?)`,
      args: [OWNER, now, OWNER, now, OWNER, now, OWNER, now, OWNER, now],
    });
  });

  const remaining = async () =>
    (
      await testDb.client.execute({
        sql: `SELECT id FROM transactions WHERE user_id = ? ORDER BY id`,
        args: [OWNER],
      })
    ).rows.map((r) => r.id);

  it("deletes every id in one request and unlinks the CSV counterpart left behind", async () => {
    const res = await del("id=tx-a,tx-b,tx-transfer");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, deleted: 3 });
    expect(await remaining()).toEqual(["tx-keep", "tx-linked"]);

    const linked = (
      await testDb.client.execute({
        sql: `SELECT type, linked_transaction_id, category_id FROM transactions WHERE id = 'tx-linked' AND user_id = ?`,
        args: [OWNER],
      })
    ).rows[0];
    // amount 50 → income, and it must not stay pointing at a deleted row
    expect(linked.type).toBe("income");
    expect(linked.linked_transaction_id).toBeNull();
    expect(linked.category_id).toBeNull();
  });

  it("skips ids that no longer exist and 404s only when none match", async () => {
    expect((await del("id=tx-a,tx-gone")).status).toBe(200);
    expect(await remaining()).toEqual(["tx-b", "tx-keep", "tx-linked", "tx-transfer"]);
    expect((await del("id=tx-gone")).status).toBe(404);
  });

  it("a viewer cannot delete a batch on the account they can only read", async () => {
    actor = VIEWER;
    const res = await del("id=tx-linked");

    expect(res.status).toBe(403);
    expect(await remaining()).toHaveLength(5);
  });

  it("refuses a batch containing an account the caller cannot write, deleting nothing", async () => {
    actor = VIEWER;
    // tx-a lives on the unshared private account (404, existence hidden) and
    // tx-linked on the read-only share (403) — either way, no row goes.
    const res = await del("id=tx-a,tx-linked");

    expect([403, 404]).toContain(res.status);
    expect(await remaining()).toHaveLength(5);
  });

  it("400s an empty or blank id list before touching anything", async () => {
    for (const query of ["id=", "id=%20", "id=,,%20,", "notid=tx-a"]) {
      expect((await del(query)).status).toBe(400);
    }
    expect(await remaining()).toHaveLength(5);
  });

  it("accepts repeated id params and collapses duplicates", async () => {
    const res = await del("id=tx-a&id=tx-b,tx-a&id=tx-a");
    expect(res.status).toBe(200);
    // tx-a counted once, not three times.
    expect(await res.json()).toMatchObject({ deleted: 2 });
    expect(await remaining()).toEqual(["tx-keep", "tx-linked", "tx-transfer"]);
  });

  it("refuses a batch larger than the 200-id cap, deleting nothing", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `bulk-${i}`);
    const res = await del(`id=${ids.join(",")}`);
    expect(res.status).toBe(400);
    expect(await remaining()).toHaveLength(5);
  });

  // The delete is scoped `id IN (…) AND user_id IN (…)` rather than as exact
  // (id, owner) pairs, which is only safe because every id came back from the
  // lookup above. Pin the blast radius: a batch spanning two owners must take
  // exactly its own rows and leave every other row of both owners alone.
  it("a batch spanning two owners deletes only the rows it named", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
            VALUES ('acc-editor', ?, 'Editor own', 'checking', 'EUR', 0, 2, ?, ?)`,
      args: [EDITOR, now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_manual, created_at)
            VALUES ('tx-ed-go', ?, 'acc-editor', '2026-08-05', 'Editor go', -7, 'expense', 0, ?),
                   ('tx-ed-keep', ?, 'acc-editor', '2026-08-06', 'Editor keep', -8, 'expense', 0, ?)`,
      args: [EDITOR, now, EDITOR, now],
    });

    actor = EDITOR;
    // 'tx-linked' is OWNER's row on the shared account EDITOR may write.
    const res = await del("id=tx-linked,tx-ed-go");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 2 });

    // EDITOR's untouched row survives...
    const editorRows = (
      await testDb.client.execute({
        sql: `SELECT id FROM transactions WHERE user_id = ? ORDER BY id`,
        args: [EDITOR],
      })
    ).rows.map((r) => r.id);
    expect(editorRows).toEqual(["tx-ed-keep"]);
    // ...and so does every OWNER row the batch didn't name.
    expect(await remaining()).toEqual(["tx-a", "tx-b", "tx-keep", "tx-transfer"]);
  });
});

describe("DELETE /api/transactions — split transactions", () => {
  // 'tx-parent' is a split wrapper with two children; only the split API may
  // change a split, so deleting a child directly has to be refused.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, parent_transaction_id, created_at)
            VALUES ('tx-parent', ?, 'acc-private', '2026-08-05', 'Hypotheek', -900, 'expense', 1, NULL, ?),
                   ('tx-kid-a', ?, 'acc-private', '2026-08-05', 'Rente', -600, 'expense', 0, 'tx-parent', ?),
                   ('tx-kid-b', ?, 'acc-private', '2026-08-05', 'Aflossing', -300, 'expense', 0, 'tx-parent', ?),
                   ('tx-plain', ?, 'acc-private', '2026-08-06', 'Plain', -15, 'expense', 0, NULL, ?)`,
      args: [OWNER, now, OWNER, now, OWNER, now, OWNER, now],
    });
  });

  const ids = async () =>
    (
      await testDb.client.execute({
        sql: `SELECT id FROM transactions WHERE user_id = ? ORDER BY id`,
        args: [OWNER],
      })
    ).rows.map((r) => r.id);

  it("refuses to delete a split child directly — the sum invariant is the split API's job", async () => {
    const res = await del("id=tx-kid-a");
    expect(res.status).toBe(400);
    expect(await ids()).toContain("tx-kid-a");
  });

  it("refuses the whole batch when one id is a split child, deleting nothing", async () => {
    const before = await ids();
    const res = await del("id=tx-plain,tx-kid-b");
    expect(res.status).toBe(400);
    expect(await ids()).toEqual(before);
  });

  it("deleting a split parent takes its children with it", async () => {
    // The self-FK is added by ALTER and carries no ON DELETE cascade, so the
    // route removes the children explicitly — otherwise they are orphaned.
    const res = await del("id=tx-parent");
    expect(res.status).toBe(200);
    const left = await ids();
    expect(left).not.toContain("tx-parent");
    expect(left).not.toContain("tx-kid-a");
    expect(left).not.toContain("tx-kid-b");
    expect(left).toContain("tx-plain");
  });

  it("counts the parent once, not its children, in the deleted total", async () => {
    expect(await (await del("id=tx-parent,tx-plain")).json()).toMatchObject({
      deleted: 2,
    });
  });
});

const categorize = (body: unknown) =>
  import("./categorize/route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/transactions/categorize", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

/** An uncategorized owner expense on the account that was never shared. */
async function seedPrivateExpense() {
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES ('tx-private', ?, 'acc-private', '2026-08-01', 'Secret groceries', -20, 'expense', ?)`,
    args: [OWNER, new Date().toISOString()],
  });
}

describe("PUT /api/transactions/categorize — rule creation is owner-only", () => {
  it("a viewer cannot plant a rule in the owner's space or touch the owner's unshared account", async () => {
    await seedPrivateExpense();
    actor = VIEWER;

    const res = await categorize({
      transactionIds: ["tx-private"],
      categoryId: "cat-owner",
      createRule: true,
      rulePattern: "groceries",
      ruleMatchType: "contains",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ruleId: null, appliedCount: 0 });

    const rules = await testDb.client.execute({
      sql: `SELECT id FROM category_rules WHERE user_id = ?`,
      args: [OWNER],
    });
    expect(rules.rows).toHaveLength(0);

    const tx = await testDb.client.execute({
      sql: `SELECT category_id FROM transactions WHERE id = 'tx-private' AND user_id = ?`,
      args: [OWNER],
    });
    expect(tx.rows[0].category_id).toBeNull();
  });

  it("an editor on a shared account still cannot — a rule reaches accounts outside the share", async () => {
    await seedPrivateExpense();
    actor = EDITOR;

    await categorize({
      transactionIds: ["tx-private"],
      categoryId: "cat-owner",
      createRule: true,
      rulePattern: "groceries",
      ruleMatchType: "contains",
    });

    const rules = await testDb.client.execute({
      sql: `SELECT id FROM category_rules WHERE user_id = ?`,
      args: [OWNER],
    });
    expect(rules.rows).toHaveLength(0);
  });

  it("the owner still creates the rule and it applies to their own rows", async () => {
    await seedPrivateExpense();
    actor = OWNER;

    const res = await categorize({
      transactionIds: ["tx-private"],
      categoryId: "cat-owner",
      createRule: true,
      rulePattern: "groceries",
      ruleMatchType: "contains",
    });

    const body = await res.json();
    expect(body.ruleId).not.toBeNull();

    const rules = await testDb.client.execute({
      sql: `SELECT category_id FROM category_rules WHERE user_id = ?`,
      args: [OWNER],
    });
    expect(rules.rows).toHaveLength(1);
    expect(rules.rows[0].category_id).toBe("cat-owner");
  });
});

describe("PUT /api/transactions/categorize — split parents", () => {
  // Once a transaction is split, only its children carry a category; letting
  // the wrapper take one would double-count it against the budget.
  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, is_split_parent, parent_transaction_id, created_at)
            VALUES ('tx-wrapper', ?, 'acc-private', '2026-08-05', 'Hypotheek', -900, 'expense', 1, NULL, ?),
                   ('tx-slice', ?, 'acc-private', '2026-08-05', 'Rente', -900, 'expense', 0, 'tx-wrapper', ?)`,
      args: [OWNER, now, OWNER, now],
    });
  });

  const categoryOf = async (id: string) =>
    (
      await testDb.client.execute({
        sql: `SELECT category_id FROM transactions WHERE id = ? AND user_id = ?`,
        args: [id, OWNER],
      })
    ).rows[0].category_id;

  it("400s rather than categorizing a split wrapper", async () => {
    const res = await categorize({
      transactionIds: ["tx-wrapper"],
      categoryId: "cat-owner",
    });
    expect(res.status).toBe(400);
    expect(await categoryOf("tx-wrapper")).toBeNull();
  });

  it("rejects the whole batch when a wrapper is mixed in, so nothing half-applies", async () => {
    const res = await categorize({
      transactionIds: ["tx-slice", "tx-wrapper"],
      categoryId: "cat-owner",
    });
    expect(res.status).toBe(400);
    expect(await categoryOf("tx-slice")).toBeNull();
  });

  it("still categorizes the children — they are ordinary rows", async () => {
    const res = await categorize({
      transactionIds: ["tx-slice"],
      categoryId: "cat-owner",
    });
    expect(res.status).toBe(200);
    expect(await categoryOf("tx-slice")).toBe("cat-owner");
  });
});
