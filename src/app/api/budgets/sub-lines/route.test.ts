import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "sub-lines-route-user";
const OTHER_USER = "sub-lines-route-other-user";

// The route only needs the caller's id; everything else is real DB work.
vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("budget-sub-lines-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, USER, "sub-lines-route@test.dev", Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('sl-cat', ?, 'Groceries', ?)`,
    args: [USER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES ('sl-budget', ?, NULL, 'sl-cat', 300, 'monthly', 1, 'active', 'manual', ?)`,
    args: [USER, now],
  });
});

const post = (body: unknown) =>
  import("./route").then(({ POST }) =>
    POST(
      new Request("http://x/api/budgets/sub-lines", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const put = (body: unknown) =>
  import("./route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/budgets/sub-lines", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const del = (id: string) =>
  import("./route").then(({ DELETE }) =>
    DELETE(
      new Request(`http://x/api/budgets/sub-lines?id=${id}`, {
        method: "DELETE",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const putAllocation = (body: unknown) =>
  import("../route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/budgets", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const deleteAllocation = (id: string) =>
  import("../route").then(({ DELETE }) =>
    DELETE(
      new Request(`http://x/api/budgets?id=${id}`, {
        method: "DELETE",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const subLineCount = async () =>
  Number(
    (await testDb.client.execute("SELECT COUNT(*) AS c FROM budget_sub_lines"))
      .rows[0].c,
  );

/** The allocation's stored amount — the number the roll-up writes. */
const allocationAmount = async (id = "sl-budget") =>
  Number(
    (
      await testDb.client.execute({
        sql: "SELECT amount AS a FROM budgets WHERE id = ?",
        args: [id],
      })
    ).rows[0].a,
  );

const subLineAmount = async (id: string) =>
  Number(
    (
      await testDb.client.execute({
        sql: "SELECT amount AS a FROM budget_sub_lines WHERE id = ?",
        args: [id],
      })
    ).rows[0].a,
  );

describe("POST /api/budgets/sub-lines", () => {
  it("creates a root sub-line and a nested child under it", async () => {
    const rootRes = await post({ allocationId: "sl-budget", name: "Gas", amount: 100 });
    expect(rootRes.status).toBe(201);
    const root = await rootRes.json();

    const childRes = await post({
      allocationId: "sl-budget",
      parentId: root.id,
      name: "Premium Gas",
      amount: 50,
    });
    expect(childRes.status).toBe(201);
  });

  it("sets the allocation to the sum of its roots, ignoring the old amount", async () => {
    // The allocation starts at 300; one €100 root makes it €100, not €300.
    await post({ allocationId: "sl-budget", name: "Gas", amount: 100 });
    expect(await allocationAmount()).toBe(100);
  });

  it("re-sums the allocation when a second root arrives", async () => {
    await post({ allocationId: "sl-budget", name: "A", amount: 100 });
    await post({ allocationId: "sl-budget", name: "B", amount: 150 });
    expect(await allocationAmount()).toBe(250);
  });

  it("lets roots grow past the allocation's original amount", async () => {
    await post({ allocationId: "sl-budget", name: "A", amount: 400 });
    const second = await post({ allocationId: "sl-budget", name: "B", amount: 250 });
    expect(second.status).toBe(201);
    expect(await allocationAmount()).toBe(650);
  });

  it("rolls a grandchild up two levels", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Root", amount: 10 })
    ).json();
    const child = await (
      await post({ allocationId: "sl-budget", parentId: root.id, name: "Child", amount: 20 })
    ).json();
    // Root now derives from its one child.
    expect(await subLineAmount(root.id)).toBe(20);
    expect(await allocationAmount()).toBe(20);

    await post({ allocationId: "sl-budget", parentId: child.id, name: "Grandchild", amount: 75 });
    expect(await subLineAmount(child.id)).toBe(75);
    expect(await subLineAmount(root.id)).toBe(75);
    expect(await allocationAmount()).toBe(75);
  });

  it("rejects a 4th nesting level", async () => {
    const level1 = await (
      await post({ allocationId: "sl-budget", name: "L1", amount: 300 })
    ).json();
    const level2 = await (
      await post({ allocationId: "sl-budget", parentId: level1.id, name: "L2", amount: 300 })
    ).json();
    const level3 = await (
      await post({ allocationId: "sl-budget", parentId: level2.id, name: "L3", amount: 300 })
    ).json();

    const res = await post({
      allocationId: "sl-budget",
      parentId: level3.id,
      name: "L4",
      amount: 10,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("3 levels deep");
    // Still a translatable code, not just English prose.
    expect(body.code).toBe("sub_line_too_deep");
  });

  it("rejects the row past the per-allocation cap, with a translatable code", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 100; i++) {
      await testDb.client.execute({
        sql: `INSERT INTO budget_sub_lines (id, user_id, allocation_id, parent_id, name, amount, created_at)
              VALUES (?, ?, 'sl-budget', NULL, ?, 1, ?)`,
        args: [`bulk-${i}`, USER, `Bulk ${i}`, now],
      });
    }

    const res = await post({ allocationId: "sl-budget", name: "One too many", amount: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_too_many");
    expect(await subLineCount()).toBe(100);
  });

  it("refuses a child under a line that stands for a recurring plan", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Gym", amount: 30 })
    ).json();
    await testDb.client.execute({
      sql: `UPDATE budget_sub_lines SET recurring_transaction_id = 'rec-1' WHERE id = ?`,
      args: [root.id],
    });

    const res = await post({
      allocationId: "sl-budget",
      parentId: root.id,
      name: "Shoes",
      amount: 10,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_parent_recurring");
  });

  it("rejects a zero or negative amount, matching what the form allows", async () => {
    expect((await post({ allocationId: "sl-budget", name: "Zero", amount: 0 })).status).toBe(400);
    expect((await post({ allocationId: "sl-budget", name: "Neg", amount: -5 })).status).toBe(400);
  });

  it("404s when the allocation belongs to another user", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [OTHER_USER, OTHER_USER, "other@test.dev", Date.now(), Date.now()],
    });
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('other-cat', ?, 'Fun', ?)`,
      args: [OTHER_USER, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
            VALUES ('other-budget', ?, NULL, 'other-cat', 200, 'monthly', 1, 'active', 'manual', ?)`,
      args: [OTHER_USER, now],
    });

    const res = await post({ allocationId: "other-budget", name: "Nope", amount: 10 });
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/budgets/sub-lines", () => {
  it("re-sums every ancestor when a leaf's amount changes", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Root", amount: 100 })
    ).json();
    const child = await (
      await post({ allocationId: "sl-budget", parentId: root.id, name: "Child", amount: 60 })
    ).json();
    const leaf = await (
      await post({ allocationId: "sl-budget", parentId: child.id, name: "Leaf", amount: 40 })
    ).json();
    expect(await allocationAmount()).toBe(40);

    const res = await put({ id: leaf.id, amount: 90 });
    expect(res.status).toBe(200);
    expect(await subLineAmount(child.id)).toBe(90);
    expect(await subLineAmount(root.id)).toBe(90);
    expect(await allocationAmount()).toBe(90);
  });

  it("adds a sibling's edit into the container total instead of capping it", async () => {
    const a = await (
      await post({ allocationId: "sl-budget", name: "A", amount: 100 })
    ).json();
    await post({ allocationId: "sl-budget", name: "B", amount: 150 });

    const res = await put({ id: a.id, amount: 500 });
    expect(res.status).toBe(200);
    expect(await allocationAmount()).toBe(650);
  });

  it("leaves the recurring link alone on a name/amount edit", async () => {
    const line = await (
      await post({ allocationId: "sl-budget", name: "Netflix", amount: 12 })
    ).json();
    await testDb.client.execute({
      sql: `UPDATE budget_sub_lines SET recurring_transaction_id = 'rec-1' WHERE id = ?`,
      args: [line.id],
    });

    expect((await put({ id: line.id, name: "Netflix HD", amount: 15 })).status).toBe(200);
    const [row] = (
      await testDb.client.execute({
        sql: `SELECT recurring_transaction_id AS r FROM budget_sub_lines WHERE id = ?`,
        args: [line.id],
      })
    ).rows;
    expect(row.r).toBe("rec-1");
  });

  /** A recurring plan the target sub-line's own user owns, ready to link. */
  const insertRecurring = async (
    id: string,
    opts: { userId?: string; amount?: number; frequency?: string; accountId?: string } = {},
  ) => {
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions
            (id, user_id, account_id, description, amount, type, frequency, start_date, created_at)
            VALUES (?, ?, ?, 'Gym', ?, 'expense', ?, '2026-01-01', ?)`,
      args: [
        id,
        opts.userId ?? USER,
        opts.accountId ?? "acc-1",
        opts.amount ?? 30,
        opts.frequency ?? "monthly",
        new Date().toISOString(),
      ],
    });
  };

  it("links a plan: the amount becomes its monthly figure and ancestors re-sum", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Root", amount: 10 })
    ).json();
    const leaf = await (
      await post({ allocationId: "sl-budget", parentId: root.id, name: "Gym", amount: 20 })
    ).json();
    await insertRecurring("rec-link", { amount: 60, frequency: "yearly" });

    const res = await put({ id: leaf.id, recurringId: "rec-link" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recurringTransactionId).toBe("rec-link");
    // 60/yr -> 5/month.
    expect(await subLineAmount(leaf.id)).toBeCloseTo(5);
    expect(await subLineAmount(root.id)).toBeCloseTo(5);
    expect(await allocationAmount()).toBeCloseTo(5);
  });

  it("rejects linking a plan that's already linked to another sub-line", async () => {
    const a = await (
      await post({ allocationId: "sl-budget", name: "A", amount: 10 })
    ).json();
    const b = await (
      await post({ allocationId: "sl-budget", name: "B", amount: 10 })
    ).json();
    await insertRecurring("rec-taken");
    expect((await put({ id: a.id, recurringId: "rec-taken" })).status).toBe(200);

    const res = await put({ id: b.id, recurringId: "rec-taken" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("recurring_already_linked");
  });

  it("rejects linking a plan onto a line that already has children", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Root", amount: 10 })
    ).json();
    await post({ allocationId: "sl-budget", parentId: root.id, name: "Child", amount: 10 });
    await insertRecurring("rec-container");

    const res = await put({ id: root.id, recurringId: "rec-container" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_has_children");
  });

  it("rejects linking another user's plan", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [OTHER_USER, OTHER_USER, "other-link@test.dev", Date.now(), Date.now()],
    });
    await insertRecurring("rec-theirs", { userId: OTHER_USER });
    const line = await (
      await post({ allocationId: "sl-budget", name: "Gym", amount: 10 })
    ).json();

    const res = await put({ id: line.id, recurringId: "rec-theirs" });
    expect(res.status).toBe(404);
  });

  it("unlinking leaves the amount where it is", async () => {
    const line = await (
      await post({ allocationId: "sl-budget", name: "Gym", amount: 10 })
    ).json();
    await insertRecurring("rec-unlink", { amount: 45, frequency: "monthly" });
    expect((await put({ id: line.id, recurringId: "rec-unlink" })).status).toBe(200);
    expect(await subLineAmount(line.id)).toBe(45);

    const res = await put({ id: line.id, recurringId: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recurringTransactionId).toBeNull();
    expect(await subLineAmount(line.id)).toBe(45);
  });

  it("a name-only edit leaves an existing link intact", async () => {
    const line = await (
      await post({ allocationId: "sl-budget", name: "Gym", amount: 10 })
    ).json();
    await insertRecurring("rec-name-only", { amount: 45, frequency: "monthly" });
    expect((await put({ id: line.id, recurringId: "rec-name-only" })).status).toBe(200);

    const res = await put({ id: line.id, name: "Gym membership" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recurringTransactionId).toBe("rec-name-only");
    expect(body.name).toBe("Gym membership");
  });
});

describe("DELETE /api/budgets/sub-lines", () => {
  it("takes the whole subtree with it, at full depth", async () => {
    const l1 = await (
      await post({ allocationId: "sl-budget", name: "L1", amount: 250 })
    ).json();
    const l2 = await (
      await post({ allocationId: "sl-budget", parentId: l1.id, name: "L2", amount: 200 })
    ).json();
    await post({ allocationId: "sl-budget", parentId: l2.id, name: "L3", amount: 100 });
    // A sibling of L1 that must survive the delete.
    await post({ allocationId: "sl-budget", name: "Keep", amount: 50 });
    expect(await subLineCount()).toBe(4);

    const res = await del(l1.id);
    expect(res.status).toBe(200);
    expect(await subLineCount()).toBe(1);
  });

  it("re-sums the ancestors a deleted middle node leaves behind", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Root", amount: 10 })
    ).json();
    const keep = await (
      await post({ allocationId: "sl-budget", parentId: root.id, name: "Keep", amount: 30 })
    ).json();
    const middle = await (
      await post({ allocationId: "sl-budget", parentId: root.id, name: "Middle", amount: 70 })
    ).json();
    // Middle carries a child, so the subtree's 25 is what leaves with it.
    await post({ allocationId: "sl-budget", parentId: middle.id, name: "Leaf", amount: 25 });
    expect(await subLineAmount(root.id)).toBe(55);
    expect(await allocationAmount()).toBe(55);

    expect((await del(middle.id)).status).toBe(200);
    expect(await subLineCount()).toBe(2);
    expect(await subLineAmount(keep.id)).toBe(30);
    expect(await subLineAmount(root.id)).toBe(30);
    expect(await allocationAmount()).toBe(30);
  });

  it("leaves the allocation's amount alone when the last root goes", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Only", amount: 120 })
    ).json();
    expect(await allocationAmount()).toBe(120);

    expect((await del(root.id)).status).toBe(200);
    expect(await subLineCount()).toBe(0);
    // Never silently shrink a budget: 120 stays, it does not fall to 0.
    expect(await allocationAmount()).toBe(120);
  });

  it("leaves a container's amount alone when its last child goes", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "Root", amount: 10 })
    ).json();
    const child = await (
      await post({ allocationId: "sl-budget", parentId: root.id, name: "Child", amount: 45 })
    ).json();
    expect(await subLineAmount(root.id)).toBe(45);

    expect((await del(child.id)).status).toBe(200);
    expect(await subLineAmount(root.id)).toBe(45);
    expect(await allocationAmount()).toBe(45);
  });

  it("leaves a linked recurring plan standing", async () => {
    const line = await (
      await post({ allocationId: "sl-budget", name: "Gym", amount: 30 })
    ).json();
    await testDb.client.execute({
      sql: `INSERT INTO recurring_transactions
            (id, user_id, account_id, description, amount, type, frequency, start_date, created_at)
            VALUES ('rec-keep', ?, 'acc-1', 'Gym', 30, 'expense', 'monthly', '2026-01-01', ?)`,
      args: [USER, new Date().toISOString()],
    });
    await testDb.client.execute({
      sql: `UPDATE budget_sub_lines SET recurring_transaction_id = 'rec-keep' WHERE id = ?`,
      args: [line.id],
    });

    expect((await del(line.id)).status).toBe(200);
    const rows = (
      await testDb.client.execute(`SELECT id FROM recurring_transactions WHERE id = 'rec-keep'`)
    ).rows;
    expect(rows).toHaveLength(1);
  });

  it("404s for another user's sub-line", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [OTHER_USER, OTHER_USER, "other-del@test.dev", Date.now(), Date.now()],
    });
    await testDb.client.execute({
      sql: `INSERT INTO budget_sub_lines (id, user_id, allocation_id, parent_id, name, amount, created_at)
            VALUES ('other-sl', ?, 'sl-budget', NULL, 'Theirs', 10, ?)`,
      args: [OTHER_USER, now],
    });

    expect((await del("other-sl")).status).toBe(404);
    expect(await subLineCount()).toBe(1);
  });
});

describe("PUT /api/budgets (allocation amount)", () => {
  it("no longer blocks an amount below the root sub-lines total", async () => {
    await post({ allocationId: "sl-budget", name: "A", amount: 100 });
    await post({ allocationId: "sl-budget", name: "B", amount: 150 });

    const res = await putAllocation({ id: "sl-budget", amount: 200 });
    expect(res.status).toBe(200);
    expect(await allocationAmount()).toBe(200);
  });

  it("does not re-sum existing sub-lines until one is written", async () => {
    // Pre-existing tree that totals less than its allocation: the no-migration
    // rule says a read, or an unrelated edit, must leave 300 alone.
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO budget_sub_lines (id, user_id, allocation_id, parent_id, name, amount, created_at)
            VALUES ('legacy-a', ?, 'sl-budget', NULL, 'Legacy A', 40, ?),
                   ('legacy-b', ?, 'sl-budget', NULL, 'Legacy B', 60, ?)`,
      args: [USER, now, USER, now],
    });
    expect(await allocationAmount()).toBe(300);

    // A name-only edit changes no money, so nothing re-sums either.
    expect((await put({ id: "legacy-a", name: "Renamed" })).status).toBe(200);
    expect(await allocationAmount()).toBe(300);

    // The first amount write is what pulls the allocation onto the sum.
    expect((await put({ id: "legacy-a", amount: 40 })).status).toBe(200);
    expect(await allocationAmount()).toBe(100);
  });
});

describe("DELETE /api/budgets (allocation)", () => {
  it("removes the allocation's sub-lines", async () => {
    const root = await (
      await post({ allocationId: "sl-budget", name: "A", amount: 100 })
    ).json();
    await post({ allocationId: "sl-budget", parentId: root.id, name: "A-child", amount: 50 });
    expect(await subLineCount()).toBe(2);

    const res = await deleteAllocation("sl-budget");
    expect(res.status).toBe(200);
    expect(await subLineCount()).toBe(0);
  });
});
