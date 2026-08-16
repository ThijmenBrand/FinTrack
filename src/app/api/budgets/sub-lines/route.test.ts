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
  });

  it("rejects a zero or negative amount, matching what the form allows", async () => {
    expect((await post({ allocationId: "sl-budget", name: "Zero", amount: 0 })).status).toBe(400);
    expect((await post({ allocationId: "sl-budget", name: "Neg", amount: -5 })).status).toBe(400);
  });

  it("sends a translatable code alongside every rule violation", async () => {
    await post({ allocationId: "sl-budget", name: "A", amount: 300 });
    const res = await post({ allocationId: "sl-budget", name: "B", amount: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("sub_line_exceeds_parent");
  });

  it("rejects siblings that would exceed the container cap", async () => {
    const r1 = await post({ allocationId: "sl-budget", name: "A", amount: 100 });
    expect(r1.status).toBe(201);
    const r2 = await post({ allocationId: "sl-budget", name: "B", amount: 150 });
    expect(r2.status).toBe(201);
    const r3 = await post({ allocationId: "sl-budget", name: "C", amount: 100 });
    expect(r3.status).toBe(400);
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
  it("blocks shrinking a sub-line below its children's total", async () => {
    const parent = await (
      await post({ allocationId: "sl-budget", name: "Parent", amount: 100 })
    ).json();
    await post({ allocationId: "sl-budget", parentId: parent.id, name: "Child", amount: 80 });

    const shrinkRes = await put({ id: parent.id, amount: 50 });
    expect(shrinkRes.status).toBe(400);

    const okRes = await put({ id: parent.id, amount: 90 });
    expect(okRes.status).toBe(200);
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

describe("PUT /api/budgets (allocation shrink guard)", () => {
  it("blocks shrinking an allocation below its root sub-lines total", async () => {
    await post({ allocationId: "sl-budget", name: "A", amount: 100 });
    await post({ allocationId: "sl-budget", name: "B", amount: 150 });

    const tooLow = await putAllocation({ id: "sl-budget", amount: 200 });
    expect(tooLow.status).toBe(400);

    const equal = await putAllocation({ id: "sl-budget", amount: 250 });
    expect(equal.status).toBe(200);
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
