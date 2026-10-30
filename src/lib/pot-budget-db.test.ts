import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "pot-budget-db-user";
const OTHER = "pot-budget-db-other";

let testDb: TestDb;
const NOW = new Date().toISOString();
let seq = 0;

beforeAll(async () => {
  testDb = await setupTestDb("pot-budget-db");
});
afterAll(() => testDb.cleanup());

beforeEach(async () => {
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
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('c1', ?, 'One', ?), ('c2', ?, 'Two', ?)`,
    args: [USER, NOW, USER, NOW],
  });
  for (const id of ["pot-1", "pot-2"]) {
    await testDb.client.execute({
      sql: `INSERT INTO transaction_groups (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, USER, id, NOW],
    });
  }
});

const tx = (
  amount: number,
  potId: string,
  categoryId: string | null,
  opts: { userId?: string; type?: string; isSplitParent?: boolean; id?: string; parent?: string } = {},
) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions
            (id, user_id, account_id, date, description, amount, type, category_id, group_id, is_split_parent, parent_transaction_id, created_at)
          VALUES (?, ?, 'acc-1', '2026-07-01', 't', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      opts.id ?? `tx-${++seq}`,
      opts.userId ?? USER,
      amount,
      opts.type ?? (amount < 0 ? "expense" : "income"),
      categoryId,
      potId,
      opts.isSplitParent ? 1 : 0,
      opts.parent ?? null,
      NOW,
    ],
  });

describe("loadPotCategoryNets", () => {
  it("sums per pot and category, leaving out transfers, split parents and other users' rows", async () => {
    const { db } = await import("@/db");
    const { loadPotCategoryNets } = await import("./pot-budget-db");
    await tx(-50, "pot-1", "c1");
    await tx(10, "pot-1", "c1");
    await tx(-7, "pot-1", null);
    await tx(500, "pot-1", null, { type: "internal_transfer" });
    await tx(-100, "pot-1", "c2", { isSplitParent: true, id: "parent" });
    await tx(-40, "pot-1", "c2", { parent: "parent" });
    await tx(-999, "pot-1", "c1", { userId: OTHER });
    await tx(-3, "pot-2", "c1");

    const nets = await loadPotCategoryNets(db, USER, ["pot-1", "pot-2"]);

    const sorted = (potId: string) =>
      [...(nets.get(potId) ?? [])].sort((a, b) => String(a.categoryId).localeCompare(String(b.categoryId)));
    expect(sorted("pot-1")).toEqual([
      { categoryId: "c1", net: -40 },
      { categoryId: "c2", net: -40 },
      { categoryId: null, net: -7 },
    ]);
    expect(sorted("pot-2")).toEqual([{ categoryId: "c1", net: -3 }]);
  });

  it("does nothing for no pots", async () => {
    const { db } = await import("@/db");
    const { loadPotCategoryNets, loadPotTrees } = await import("./pot-budget-db");
    expect((await loadPotCategoryNets(db, USER, [])).size).toBe(0);
    expect((await loadPotTrees(db, USER, [])).size).toBe(0);
  });
});

describe("replacePotBudget", () => {
  it("writes lines in order with their categories, scoped per pot", async () => {
    const { db } = await import("@/db");
    const { replacePotBudget, loadPotTrees, topLevelPlannedCents } = await import("./pot-budget-db");

    await db.transaction((t) =>
      replacePotBudget(t, USER, "pot-1", {
        total: 30.3,
        lines: [
          { name: "A", amount: 10.1, categoryIds: ["c1"], children: [] },
          {
            name: "B",
            amount: 20.2,
            categoryIds: [],
            children: [{ name: "B1", amount: 20.2, categoryIds: ["c2"], children: [] }],
          },
        ],
      }),
    );
    await db.transaction((t) =>
      replacePotBudget(t, USER, "pot-2", {
        total: 5,
        lines: [{ name: "Z", amount: 5, categoryIds: ["c1"], children: [] }],
      }),
    );

    const trees = await loadPotTrees(db, USER, ["pot-1", "pot-2"]);
    expect(trees.get("pot-1")!.map((l) => [l.name, l.amount, l.categoryIds, l.children.map((c) => c.name)])).toEqual([
      ["A", 10.1, ["c1"], []],
      ["B", 20.2, [], ["B1"]],
    ]);
    // The same category on another pot's line is fine — uniqueness is per pot.
    expect(trees.get("pot-2")![0].categoryIds).toEqual(["c1"]);
    expect(await topLevelPlannedCents(db, USER, "pot-1")).toBe(3030);
    expect(await topLevelPlannedCents(db, USER, "pot-2")).toBe(500);
    expect(await loadPotTrees(db, OTHER, ["pot-1"])).toEqual(new Map());
  });

  it("is backstopped by the unique index if two lines claim one category", async () => {
    const { db } = await import("@/db");
    const { replacePotBudget } = await import("./pot-budget-db");

    await expect(
      db.transaction((t) =>
        replacePotBudget(t, USER, "pot-1", {
          total: 2,
          lines: [
            { name: "A", amount: 1, categoryIds: ["c1"], children: [] },
            { name: "B", amount: 1, categoryIds: ["c1"], children: [] },
          ],
        }),
      ),
    ).rejects.toThrow();
    // Rolled back: nothing half-written.
    const { rows } = await testDb.client.execute(`SELECT COUNT(*) AS n FROM pot_budget_lines`);
    expect(rows[0].n).toBe(0);
  });
});

describe("userOwnsCategories", () => {
  it("needs every id to be the user's", async () => {
    const { db } = await import("@/db");
    const { userOwnsCategories } = await import("./pot-budget-db");
    expect(await userOwnsCategories(db, USER, [])).toBe(true);
    expect(await userOwnsCategories(db, USER, ["c1", "c2", "c1"])).toBe(true);
    expect(await userOwnsCategories(db, USER, ["c1", "nope"])).toBe(false);
    expect(await userOwnsCategories(db, OTHER, ["c1"])).toBe(false);
  });
});
