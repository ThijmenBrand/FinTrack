import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "split-route-owner";
const EDITOR = "split-route-editor";
const VIEWER = "split-route-viewer";

// The route only needs the caller's id; everything else is real DB work.
// `actor` is mutable so each case can act as a different member. Mirrors the
// real withUser: requireAccountAccess THROWS a Response for 403/404, which the
// real wrapper catches — this mock must too, or the throw surfaces as an
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
  testDb = await setupTestDb("transactions-split-route");
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
    sql: `INSERT INTO categories (id, user_id, name, created_at)
          VALUES ('cat-owner', ?, 'Groceries', ?), ('cat-editor', ?, 'Fun', ?)`,
    args: [OWNER, now, EDITOR, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
          VALUES ('am-editor', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?),
                 ('am-viewer', 'acc-shared', ?, 'viewer@test.dev', 'viewer', ?, ?)`,
    args: [EDITOR, now, now, VIEWER, now, now],
  });
  // 'tx-shared' lives on the joint account (owner's user_id, per the
  // shared-accounts model); 'tx-private' on the unshared one.
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES ('tx-shared', ?, 'acc-shared', '2026-08-09', 'Groceries', -100, 'expense', ?),
                 ('tx-private', ?, 'acc-private', '2026-08-09', 'Solo', -50, 'expense', ?)`,
    args: [OWNER, now, OWNER, now],
  });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const call = async (
  method: "POST" | "PUT" | "DELETE",
  id: string,
  body?: unknown,
) => {
  const mod = await import("./route");
  const request = new Request(`http://x/api/transactions/${id}/split`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mod[method](request as any, params(id) as any);
};

const childRows = async (parentId: string) =>
  (
    await testDb.client.execute({
      sql: `SELECT * FROM transactions WHERE parent_transaction_id = ? ORDER BY rowid`,
      args: [parentId],
    })
  ).rows;

const EVEN = [{ amount: -50 }, { amount: -50 }];

describe("POST /api/transactions/[id]/split — body validation", () => {
  it.each([
    ["a missing body", undefined],
    ["a body with no splits key", {}],
    ["splits that is not an array", { splits: "nope" }],
    ["splits containing null", { splits: [null, { amount: -50 }] }],
    ["splits containing a primitive", { splits: [{ amount: -50 }, 42] }],
    // Non-string text fields would reach applySplit's .trim() and throw,
    // surfacing as a 500 instead of a 400.
    [
      "a non-string description",
      { splits: [{ amount: -50, description: 42 }, { amount: -50 }] },
    ],
    ["a non-string notes", { splits: [{ amount: -50, notes: [] }, { amount: -50 }] }],
    [
      "a non-string categoryId",
      { splits: [{ amount: -50, categoryId: 7 }, { amount: -50 }] },
    ],
  ])("400s on %s", async (_label, body) => {
    const res = await call("POST", "tx-shared", body);
    expect(res.status).toBe(400);
    expect(await childRows("tx-shared")).toHaveLength(0);
  });

  it("400s on a malformed JSON body rather than throwing", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://x/api/transactions/tx-shared/split", {
      method: "POST",
      body: "{not json",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(request as any, params("tx-shared") as any);
    expect(res.status).toBe(400);
  });

  it("passes an empty array through to the domain rule (needs two parts)", async () => {
    const res = await call("POST", "tx-shared", { splits: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/two parts|twee delen/i);
  });
});

describe("POST /api/transactions/[id]/split — access", () => {
  it("404s on a transaction that does not exist", async () => {
    expect((await call("POST", "ghost", { splits: EVEN })).status).toBe(404);
  });

  it("404s on a transaction the caller cannot see at all", async () => {
    actor = EDITOR; // editor on acc-shared only, never on acc-private
    const res = await call("POST", "tx-private", { splits: EVEN });
    expect(res.status).toBe(404);
    expect(await childRows("tx-private")).toHaveLength(0);
  });

  it("403s a viewer on the account they can only read", async () => {
    actor = VIEWER;
    const res = await call("POST", "tx-shared", { splits: EVEN });
    expect(res.status).toBe(403);
    expect(await childRows("tx-shared")).toHaveLength(0);
  });

  it("lets an editor split a shared row: children keep the OWNER's user_id, credited to the editor", async () => {
    actor = EDITOR;
    const res = await call("POST", "tx-shared", {
      splits: [{ amount: -40 }, { amount: -60 }],
    });
    expect(res.status).toBe(200);
    const { success, childIds } = await res.json();
    expect(success).toBe(true);
    expect(childIds).toHaveLength(2);

    const kids = await childRows("tx-shared");
    expect(kids.map((k) => k.id)).toEqual(childIds);
    for (const kid of kids) {
      expect(kid.user_id).toBe(OWNER);
      expect(kid.created_by).toBe(EDITOR);
    }
  });

  it("validates categories in the OWNER's space, not the acting editor's", async () => {
    actor = EDITOR;
    const res = await call("POST", "tx-shared", {
      splits: [{ amount: -40, categoryId: "cat-editor" }, { amount: -60 }],
    });
    // cat-editor belongs to the editor, not to the account owner the rows hang off.
    expect(res.status).toBe(400);
    expect(await childRows("tx-shared")).toHaveLength(0);
  });
});

describe("POST/PUT /api/transactions/[id]/split — outcomes", () => {
  it("relays a domain refusal with its own status", async () => {
    const res = await call("POST", "tx-shared", {
      splits: [{ amount: -40 }, { amount: -70 }],
    });
    expect(res.status).toBe(400);
    expect(await childRows("tx-shared")).toHaveLength(0);
  });

  it("PUT re-splits an already-split row in place", async () => {
    await call("POST", "tx-shared", { splits: EVEN });
    const res = await call("PUT", "tx-shared", {
      splits: [{ amount: -20 }, { amount: -30 }, { amount: -50 }],
    });
    expect(res.status).toBe(200);
    const kids = await childRows("tx-shared");
    expect(kids.map((k) => k.amount)).toEqual([-20, -30, -50]);
  });

  it("marks the parent as a wrapper and leaves its amount alone", async () => {
    await call("POST", "tx-shared", { splits: EVEN });
    const [parent] = (
      await testDb.client.execute({
        sql: `SELECT amount, is_split_parent FROM transactions WHERE id = 'tx-shared' AND user_id = ?`,
        args: [OWNER],
      })
    ).rows;
    expect(Number(parent.is_split_parent)).toBe(1);
    expect(parent.amount).toBe(-100);
  });
});

describe("DELETE /api/transactions/[id]/split — unsplit", () => {
  it("404s on an unknown id and 403s a viewer", async () => {
    expect((await call("DELETE", "ghost")).status).toBe(404);
    await call("POST", "tx-shared", { splits: EVEN });
    actor = VIEWER;
    expect((await call("DELETE", "tx-shared")).status).toBe(403);
    expect(await childRows("tx-shared")).toHaveLength(2);
  });

  it("400s when the row was never split", async () => {
    expect((await call("DELETE", "tx-shared")).status).toBe(400);
  });

  it("removes the parts and clears the wrapper flag", async () => {
    await call("POST", "tx-shared", { splits: EVEN });
    const res = await call("DELETE", "tx-shared");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await childRows("tx-shared")).toHaveLength(0);
    const [parent] = (
      await testDb.client.execute({
        sql: `SELECT is_split_parent FROM transactions WHERE id = 'tx-shared' AND user_id = ?`,
        args: [OWNER],
      })
    ).rows;
    expect(Number(parent.is_split_parent)).toBe(0);
  });

  it("an editor may unsplit a shared row", async () => {
    await call("POST", "tx-shared", { splits: EVEN });
    actor = EDITOR;
    expect((await call("DELETE", "tx-shared")).status).toBe(200);
    expect(await childRows("tx-shared")).toHaveLength(0);
  });
});
