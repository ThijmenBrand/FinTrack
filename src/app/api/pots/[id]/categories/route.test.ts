/**
 * A pot's own categories: created under one of the user's categories, picked
 * on a transaction in that pot, collected by a budget line — and forgotten
 * cleanly when deleted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { setupTestDb, type TestDb } from "@/lib/test-db";
import type { PotCategory, PotDetails } from "@/types/api";

const USER = "pot-cat-user";
const OTHER = "pot-cat-other";

let actor = USER;
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
const NOW = new Date().toISOString();

beforeAll(async () => {
  testDb = await setupTestDb("pot-categories-route");
});
afterAll(() => testDb.cleanup());

beforeEach(async () => {
  actor = USER;
  await testDb.reset();
  for (const id of [USER, OTHER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
      args: [id, id, `${id}@test.dev`],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-1', ?, 'Main', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [USER, NOW, NOW],
  });
  for (const [id, name] of [
    ["c-transport", "Transport"],
    ["c-food", "Food"],
  ]) {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, USER, name, NOW],
    });
  }
  for (const [id, userId] of [
    ["costa-rica", USER],
    ["japan", USER],
    ["theirs", OTHER],
  ]) {
    await testDb.client.execute({
      sql: `INSERT INTO transaction_groups (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, userId, id, NOW],
    });
  }
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;

const create = async (potId: string, name: string, parentCategoryId = "c-transport") => {
  const { POST } = await import("./route");
  return POST(req(`http://test/api/pots/${potId}/categories`, "POST", { name, parentCategoryId }), params(potId));
};
const createOk = async (potId: string, name: string, parent?: string): Promise<PotCategory> => {
  const res = await create(potId, name, parent);
  expect(res.status).toBe(201);
  return res.json();
};
const list = async (potId: string): Promise<PotCategory[]> => {
  const { GET } = await import("./route");
  return (await GET(req(`http://test/api/pots/${potId}/categories`, "GET"), params(potId))).json();
};
const remove = async (potId: string, categoryId: string) => {
  const { DELETE } = await import("./route");
  return DELETE(req(`http://test/api/pots/${potId}/categories?categoryId=${categoryId}`, "DELETE"), params(potId));
};
const putBudget = async (potId: string, body: unknown) => {
  const { PUT } = await import("../budget/route");
  return PUT(req(`http://test/api/pots/${potId}/budget`, "PUT", body), params(potId));
};
const details = async (potId: string): Promise<PotDetails> => {
  const { GET } = await import("../details/route");
  return (await GET(req(`http://test/api/pots/${potId}/details`, "GET"), params(potId))).json();
};
const categorize = async (body: Record<string, unknown>) => {
  const { PUT } = await import("@/app/api/transactions/categorize/route");
  return PUT(req("http://test/api/transactions/categorize", "PUT", body));
};
const tx = (id: string, amount: number, potId: string | null, categoryId: string | null, potCategoryId: string | null = null) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, group_id, pot_category_id, created_at)
          VALUES (?, ?, 'acc-1', '2026-07-14', 't', ?, 'expense', ?, ?, ?, ?)`,
    args: [id, USER, amount, categoryId, potId, potCategoryId, NOW],
  });
const potCategoryOf = async (txId: string) =>
  (await testDb.client.execute({ sql: `SELECT pot_category_id AS p FROM transactions WHERE id = ?`, args: [txId] }))
    .rows[0].p;

describe("POST /api/pots/[id]/categories", () => {
  it("creates one under a category, and hands back the same one for the same name", async () => {
    const flight = await createOk("costa-rica", "Flight");
    expect(flight).toMatchObject({ potId: "costa-rica", parentCategoryId: "c-transport", name: "Flight" });

    const again = await create("costa-rica", "  flight ");
    expect(again.status).toBe(201);
    expect((await again.json()).id).toBe(flight.id);
    expect(await list("costa-rica")).toHaveLength(1);
    // Scoped to its pot.
    expect(await list("japan")).toEqual([]);
  });

  it("refuses a missing name, someone else's pot, or a parent that isn't the user's", async () => {
    expect((await create("costa-rica", "   ")).status).toBe(400);
    expect((await create("theirs", "Flight")).status).toBe(404);
    expect((await create("costa-rica", "Flight", "c-nope")).status).toBe(404);
  });
});

describe("pot categories in a budget", () => {
  it("lands a transaction narrowed to one on the sub-line that collects it", async () => {
    const flight = await createOk("costa-rica", "Flight");
    expect(
      (
        await putBudget("costa-rica", {
          total: 3000,
          lines: [
            {
              name: "Transport",
              categoryIds: ["c-transport"],
              children: [
                { name: "Flight", amount: 2000, potCategoryIds: [flight.id] },
                { name: "Car", amount: 1000 },
              ],
            },
          ],
        })
      ).status,
    ).toBe(200);

    await tx("t-flight", -1241.8, "costa-rica", "c-transport", flight.id);
    await tx("t-plain", -50, "costa-rica", "c-transport");
    // Moved to Food since: the pot category no longer applies.
    await tx("t-stale", -20, "costa-rica", "c-food", flight.id);

    const d = await details("costa-rica");
    const [transport] = d.budget.lines;
    expect(transport.children[0]).toMatchObject({ name: "Flight", spent: 1241.8, potCategoryIds: [flight.id] });
    expect(transport.spent).toBe(1291.8);
    expect(d.budget.unplanned.groups).toEqual([{ categoryId: "c-food", potCategoryId: null, spent: 20 }]);
    expect(d.potCategories.map((c) => c.name)).toEqual(["Flight"]);
    expect(d.transactions.find((t) => t.id === "t-stale")?.potCategoryId).toBeNull();
  });

  it("refuses another pot's category on a line", async () => {
    const other = await createOk("japan", "Shinkansen");
    const res = await putBudget("costa-rica", {
      total: 10,
      lines: [{ name: "Trains", amount: 10, potCategoryIds: [other.id] }],
    });
    expect(res.status).toBe(404);
  });

  it("is let go of everywhere when deleted", async () => {
    const flight = await createOk("costa-rica", "Flight");
    await putBudget("costa-rica", { total: 10, lines: [{ name: "Flight", amount: 10, potCategoryIds: [flight.id] }] });
    await tx("t-1", -10, "costa-rica", "c-transport", flight.id);

    expect((await remove("costa-rica", flight.id)).status).toBe(200);
    expect(await potCategoryOf("t-1")).toBeNull();
    expect(await list("costa-rica")).toEqual([]);
    const d = await details("costa-rica");
    expect(d.budget.lines[0].potCategoryIds).toEqual([]);
    // Its spend falls back to its parent category, unplanned here.
    expect(d.budget.unplanned.groups).toEqual([{ categoryId: "c-transport", potCategoryId: null, spent: 10 }]);
  });
});

describe("PUT /api/transactions/categorize with potCategoryId", () => {
  it("narrows a row in the pot to one of the pot's categories under its category", async () => {
    const flight = await createOk("costa-rica", "Flight");
    await tx("t-1", -100, "costa-rica", null);

    const res = await categorize({ transactionId: "t-1", categoryId: "c-transport", potCategoryId: flight.id });
    expect(res.status).toBe(200);
    expect(await potCategoryOf("t-1")).toBe(flight.id);

    // Any later categorization that doesn't name it clears it.
    await categorize({ transactionId: "t-1", categoryId: "c-transport" });
    expect(await potCategoryOf("t-1")).toBeNull();
  });

  it("refuses one under another category, from another pot, or for a row outside the pot", async () => {
    const flight = await createOk("costa-rica", "Flight");
    const shinkansen = await createOk("japan", "Shinkansen");
    await tx("t-in", -100, "costa-rica", null);
    await tx("t-out", -100, null, null);

    const wrongParent = await categorize({ transactionId: "t-in", categoryId: "c-food", potCategoryId: flight.id });
    const wrongPot = await categorize({ transactionId: "t-in", categoryId: "c-transport", potCategoryId: shinkansen.id });
    const notInPot = await categorize({ transactionId: "t-out", categoryId: "c-transport", potCategoryId: flight.id });
    expect([wrongParent.status, wrongPot.status, notInPot.status]).toEqual([400, 400, 400]);
    expect(await potCategoryOf("t-in")).toBeNull();
  });
});

describe("moving a transaction between pots", () => {
  it("drops the pot category it had in the old pot", async () => {
    const flight = await createOk("costa-rica", "Flight");
    await tx("t-1", -100, "costa-rica", "c-transport", flight.id);
    const { POST } = await import("../../transactions/route");
    const res = await POST(req("http://test/api/pots/transactions", "POST", { potId: "japan", transactionId: "t-1" }));
    expect(res.status).toBe(200);
    expect(await potCategoryOf("t-1")).toBeNull();
  });
});
