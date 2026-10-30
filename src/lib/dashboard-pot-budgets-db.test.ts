/**
 * The "Pot budgets" dashboard card: pots being spent against a budget. A dated
 * pot belongs to Saving toward until its date, and to this card from that day
 * on; an undated budget is always here; archived pots and pots without a
 * total never are.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

const testDb = await setupTestDb("dashboard-pot-budgets");

const { getPotBudgets } = await import("@/app/(app)/_lib/dashboard-queries");
const { db } = await import("@/db");
const { replacePotBudget } = await import("@/lib/pot-budget-db");

const ME = "pot-budgets-me";
const OTHER = "pot-budgets-other";
const NOW = new Date().toISOString();
const TODAY = "2026-07-15";
let seq = 0;

afterAll(() => testDb.cleanup());

beforeEach(async () => {
  await testDb.reset();
  for (const id of [ME, OTHER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
      args: [id, id, `${id}@test.dev`],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc', ?, 'Main', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [ME, NOW, NOW],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, color, created_at) VALUES
          ('c-hotel', ?, 'Hotel', '#111111', ?), ('c-food', ?, 'Food', '#222222', ?)`,
    args: [ME, NOW, ME, NOW],
  });
});

const pot = (
  id: string,
  opts: { total?: number | null; date?: string | null; archived?: boolean; userId?: string } = {},
) =>
  testDb.client.execute({
    sql: `INSERT INTO transaction_groups (id, user_id, name, category_id, target_amount, target_date, archived_at, created_at)
          VALUES (?, ?, ?, 'c-hotel', ?, ?, ?, ?)`,
    args: [
      id,
      opts.userId ?? ME,
      id,
      opts.total === undefined ? 1000 : opts.total,
      opts.date ?? null,
      opts.archived ? NOW : null,
      NOW,
    ],
  });

const spend = (potId: string, amount: number, categoryId: string) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, group_id, created_at)
          VALUES (?, ?, 'acc', ?, 't', ?, ?, ?, ?, ?)`,
    args: [`tx-${++seq}`, ME, TODAY, amount, amount < 0 ? "expense" : "income", categoryId, potId, NOW],
  });

describe("getPotBudgets", () => {
  it("lists undated budgets and dated pots from their date to a month after — not before, not archived", async () => {
    await pot("undated");
    await pot("trip-today", { date: TODAY });
    await pot("trip-past", { date: "2026-06-20" });
    await pot("trip-long-ago", { date: "2026-06-01" });
    await pot("trip-future", { date: "2026-08-01" });
    await pot("archived", { archived: true });
    await pot("plain", { total: null });
    await pot("theirs", { userId: OTHER });

    const ids = (await getPotBudgets(ME, TODAY)).map((p) => p.id).sort();

    expect(ids).toEqual(["trip-past", "trip-today", "undated"]);
  });

  it("puts over-budget pots first and names the line furthest over", async () => {
    await pot("calm");
    await pot("close");
    await pot("blown");
    await db.transaction((tx) =>
      replacePotBudget(tx, ME, "blown", {
        total: 1000,
        lines: [
          { name: "Hotel", amount: 600, categoryIds: ["c-hotel"], children: [] },
          { name: "Food", amount: 400, categoryIds: ["c-food"], children: [] },
        ],
      }),
    );
    await spend("calm", -100, "c-hotel");
    await spend("close", -900, "c-hotel");
    await spend("blown", -750, "c-hotel");
    await spend("blown", -300, "c-food");

    const list = await getPotBudgets(ME, TODAY);

    expect(list.map((p) => [p.id, p.status])).toEqual([
      ["blown", "exceeded"],
      ["close", "warning"],
      ["calm", "ok"],
    ]);
    expect(list[0]).toMatchObject({
      total: 1000,
      spent: 1050,
      categoryColor: "#111111",
      worstLine: { name: "Hotel", overBy: 150 },
    });
    expect(list[2].worstLine).toBeNull();
  });

  it("returns nothing when there are no budgeted pots", async () => {
    await pot("plain", { total: null });
    expect(await getPotBudgets(ME, TODAY)).toEqual([]);
  });
});
