import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "recurring-route-user";
const OTHER_USER = "recurring-route-other-user";
const OWNER = "recurring-route-owner";
const EDITOR = "recurring-route-editor";

// `actor` is mutable so the shared-plan test can act as a different caller
// than the row owner. Mirrors src/app/api/budgets/route.test.ts.
let actor = USER;
vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(actor),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("recurring-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  actor = USER;
  await testDb.reset();
  for (const id of [USER, OTHER_USER, OWNER, EDITOR]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@test.dev`, Date.now(), Date.now()],
    });
  }
});

/** Inserts an account (own, unshared) and returns its id. */
async function makeAccount(id: string, userId: string) {
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, created_at, updated_at) VALUES (?, ?, 'Checking', 'checking', ?, ?)`,
    args: [id, userId, now, now],
  });
}

async function makeCategory(id: string, userId: string) {
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, 'Bills', ?)`,
    args: [id, userId, now],
  });
}

async function makeAllocation(id: string, userId: string, categoryId: string, amount: number) {
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES (?, ?, NULL, ?, ?, 'monthly', 1, 'active', 'manual', ?)`,
    args: [id, userId, categoryId, amount, now],
  });
}

async function makeSubLine(
  id: string,
  userId: string,
  allocationId: string,
  amount: number,
  recurringId: string | null = null,
) {
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO budget_sub_lines (id, user_id, allocation_id, parent_id, name, amount, recurring_transaction_id, created_at)
          VALUES (?, ?, ?, NULL, 'Netflix', ?, ?, ?)`,
    args: [id, userId, allocationId, amount, recurringId, now],
  });
}

async function makeRecurring(
  id: string,
  userId: string,
  accountId: string,
  amount: number,
  frequency: string,
) {
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, start_date, created_at)
          VALUES (?, ?, ?, 'Netflix', ?, 'expense', ?, '2026-01-01', ?)`,
    args: [id, userId, accountId, amount, frequency, now],
  });
}

const allocationAmount = async (id: string) =>
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

const subLineRecurringId = async (id: string) =>
  (
    await testDb.client.execute({
      sql: "SELECT recurring_transaction_id AS r FROM budget_sub_lines WHERE id = ?",
      args: [id],
    })
  ).rows[0].r;

const put = (body: unknown) =>
  import("./route").then(({ PUT }) =>
    PUT(
      new Request("http://x/api/recurring", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

const del = (id: string) =>
  import("./route").then(({ DELETE }) =>
    DELETE(
      new Request(`http://x/api/recurring?id=${id}`, {
        method: "DELETE",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ),
  );

describe("PUT /api/recurring — linked sub-line propagation", () => {
  it("updates the linked sub-line's amount and re-sums the allocation", async () => {
    await makeAccount("acc-1", USER);
    await makeCategory("cat-1", USER);
    await makeAllocation("alloc-1", USER, "cat-1", 70);
    // A sibling root, so the re-sum is visibly not just "copy the one line".
    await makeSubLine("sl-other", USER, "alloc-1", 20);
    await makeRecurring("rec-1", USER, "acc-1", -50, "monthly");
    await makeSubLine("sl-linked", USER, "alloc-1", 50, "rec-1");
    expect(await allocationAmount("alloc-1")).toBe(70);

    const res = await put({ id: "rec-1", amount: 80 });
    expect(res.status).toBe(200);
    expect(await subLineAmount("sl-linked")).toBe(80);
    expect(await allocationAmount("alloc-1")).toBe(100);
  });

  it("re-normalises when frequency changes: €600/yr stays a €50 monthly sub-line", async () => {
    await makeAccount("acc-2", USER);
    await makeCategory("cat-2", USER);
    await makeAllocation("alloc-2", USER, "cat-2", 50);
    await makeRecurring("rec-2", USER, "acc-2", -50, "monthly");
    await makeSubLine("sl-2", USER, "alloc-2", 50, "rec-2");

    const res = await put({ id: "rec-2", amount: 600, frequency: "yearly" });
    expect(res.status).toBe(200);
    expect(await subLineAmount("sl-2")).toBe(50);
    expect(await allocationAmount("alloc-2")).toBe(50);
  });

  it("touches no budget row when the edited plan is unlinked", async () => {
    await makeAccount("acc-3", USER);
    await makeCategory("cat-3", USER);
    await makeAllocation("alloc-3", USER, "cat-3", 30);
    await makeSubLine("sl-3", USER, "alloc-3", 30);
    await makeRecurring("rec-3", USER, "acc-3", -10, "monthly");

    const res = await put({ id: "rec-3", amount: 25 });
    expect(res.status).toBe(200);
    expect(await subLineAmount("sl-3")).toBe(30);
    expect(await allocationAmount("alloc-3")).toBe(30);
  });

  it("propagates in a shared plan: rows owned by the owner, edited by an editor member", async () => {
    await makeAccount("acc-shared", OWNER);
    await testDb.client.execute({
      sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
            VALUES ('am-1', 'acc-shared', ?, 'editor@test.dev', 'editor', ?, ?)`,
      args: [EDITOR, new Date().toISOString(), new Date().toISOString()],
    });
    await makeCategory("cat-shared", OWNER);
    await makeAllocation("alloc-shared", OWNER, "cat-shared", 50);
    await makeRecurring("rec-shared", OWNER, "acc-shared", -50, "monthly");
    await makeSubLine("sl-shared", OWNER, "alloc-shared", 50, "rec-shared");

    actor = EDITOR;
    const res = await put({ id: "rec-shared", amount: 65 });
    expect(res.status).toBe(200);
    expect(await subLineAmount("sl-shared")).toBe(65);
    expect(await allocationAmount("alloc-shared")).toBe(65);
  });
});

describe("DELETE /api/recurring — linked sub-line propagation", () => {
  it("nulls the link but leaves the sub-line's amount and the allocation standing", async () => {
    await makeAccount("acc-4", USER);
    await makeCategory("cat-4", USER);
    await makeAllocation("alloc-4", USER, "cat-4", 50);
    await makeRecurring("rec-4", USER, "acc-4", -50, "monthly");
    await makeSubLine("sl-4", USER, "alloc-4", 50, "rec-4");

    const res = await del("rec-4");
    expect(res.status).toBe(200);
    expect(await subLineRecurringId("sl-4")).toBeNull();
    expect(await subLineAmount("sl-4")).toBe(50);
    expect(await allocationAmount("alloc-4")).toBe(50);
  });

  it("is unaffected by deleting an unlinked plan", async () => {
    await makeAccount("acc-5", USER);
    await makeCategory("cat-5", USER);
    await makeAllocation("alloc-5", USER, "cat-5", 30);
    await makeSubLine("sl-5", USER, "alloc-5", 30);
    await makeRecurring("rec-5", USER, "acc-5", -10, "monthly");

    const res = await del("rec-5");
    expect(res.status).toBe(200);
    expect(await subLineAmount("sl-5")).toBe(30);
    expect(await allocationAmount("alloc-5")).toBe(30);
  });
});
