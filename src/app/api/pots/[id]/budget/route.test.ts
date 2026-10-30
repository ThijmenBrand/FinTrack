/**
 * PUT/GET /api/pots/[id]/budget, and the budget the details route reads back.
 * The tree and the pot's total are one write: a rejected budget must leave the
 * old one standing, whole.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { setupTestDb, type TestDb } from "@/lib/test-db";
import type { PotBudgetTree, PotDetails } from "@/types/api";

const USER = "pot-budget-user";
const OTHER = "pot-budget-other";

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
let seq = 0;

beforeAll(async () => {
  testDb = await setupTestDb("pot-budget-route");
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
    ["c-flights", "Flights"],
    ["c-hotel", "Hotel"],
    ["c-food", "Restaurants"],
    ["c-gifts", "Gifts"],
  ]) {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, USER, name, NOW],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('c-theirs', ?, 'Theirs', ?)`,
    args: [OTHER, NOW],
  });
});

const pot = (id: string, opts: { userId?: string; targetAmount?: number | null; targetDate?: string | null; funded?: number } = {}) =>
  testDb.client.execute({
    sql: `INSERT INTO transaction_groups (id, user_id, name, target_amount, target_date, funded_amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, opts.userId ?? USER, id, opts.targetAmount ?? null, opts.targetDate ?? null, opts.funded ?? 0, NOW],
  });

const tx = (amount: number, potId: string, categoryId: string | null, type?: string) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, group_id, created_at)
          VALUES (?, ?, 'acc-1', '2026-07-14', 't', ?, ?, ?, ?, ?)`,
    args: [`tx-${++seq}`, USER, amount, type ?? (amount < 0 ? "expense" : "income"), categoryId, potId, NOW],
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const put = async (id: string, body: unknown) => {
  const { PUT } = await import("./route");
  return PUT(
    new Request(`http://test/api/pots/${id}/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    params(id),
  );
};
const get = async (id: string) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://test/api/pots/${id}/budget`) as unknown as NextRequest, params(id));
};
const details = async (id: string): Promise<PotDetails> => {
  const { GET } = await import("../details/route");
  const res = await GET(new Request(`http://test/api/pots/${id}/details`) as unknown as NextRequest, params(id));
  expect(res.status).toBe(200);
  return res.json();
};

const line = (name: string, amount: number, categoryIds: string[] = [], children: unknown[] = []) => ({
  name,
  amount,
  categoryIds,
  children,
});

const VACATION = {
  total: 2000,
  lines: [
    line("Flights", 400, ["c-flights"]),
    line("Hotel", 800, ["c-hotel"]),
    line("Food", 0, [], [line("Dining", 500, ["c-food"]), line("Snacks", 300)]),
  ],
};

describe("PUT /api/pots/[id]/budget", () => {
  it("saves the tree and sets the pot's total in one go", async () => {
    await pot("pot-1");

    const res = await put("pot-1", VACATION);
    expect(res.status).toBe(200);

    const saved: PotBudgetTree = await (await get("pot-1")).json();
    expect(saved).toEqual({
      total: 2000,
      lines: [
        line("Flights", 400, ["c-flights"]),
        line("Hotel", 800, ["c-hotel"]),
        line("Food", 800, [], [line("Dining", 500, ["c-food"]), line("Snacks", 300)]),
      ],
    });
  });

  it("replaces the previous budget rather than adding to it", async () => {
    await pot("pot-1");
    await put("pot-1", VACATION);

    expect((await put("pot-1", { total: 100, lines: [line("All", 100, ["c-hotel"])] })).status).toBe(200);

    const saved: PotBudgetTree = await (await get("pot-1")).json();
    expect(saved).toEqual({ total: 100, lines: [line("All", 100, ["c-hotel"])] });
    const { rows } = await testDb.client.execute(`SELECT COUNT(*) AS n FROM pot_budget_lines`);
    expect(rows[0].n).toBe(1);
  });

  it("leaves the old budget whole when the new one is rejected", async () => {
    await pot("pot-1");
    await put("pot-1", VACATION);

    const res = await put("pot-1", { total: 2100, lines: VACATION.lines });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("pots.budget.err.sumMismatch");
    expect(typeof body.error).toBe("string");

    const saved: PotBudgetTree = await (await get("pot-1")).json();
    expect(saved.total).toBe(2000);
    expect(saved.lines).toHaveLength(3);
  });

  it("names the category that appears twice", async () => {
    await pot("pot-1");
    const res = await put("pot-1", {
      total: 20,
      lines: [line("A", 10, ["c-hotel"]), line("B", 10, ["c-hotel"])],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "pots.budget.err.duplicateCategory", categoryId: "c-hotel" });
  });

  it("refuses a category that isn't the user's", async () => {
    await pot("pot-1");
    expect((await put("pot-1", { total: 10, lines: [line("A", 10, ["c-theirs"])] })).status).toBe(404);
    expect((await put("pot-1", { total: 10, lines: [line("A", 10, ["c-nope"])] })).status).toBe(404);
  });

  it("can't touch another user's pot", async () => {
    await pot("pot-theirs", { userId: OTHER });
    expect((await put("pot-theirs", { total: 10, lines: [] })).status).toBe(404);
    expect((await get("pot-theirs")).status).toBe(404);
  });

  it("clears the budget and the funding with it", async () => {
    await pot("pot-1", { targetAmount: 100, funded: 40 });
    await put("pot-1", { total: 100, lines: [line("All", 100)] });

    expect((await put("pot-1", { total: null, lines: [] })).status).toBe(200);

    const { rows } = await testDb.client.execute(`SELECT target_amount, funded_amount FROM transaction_groups`);
    expect(rows[0]).toMatchObject({ target_amount: null, funded_amount: 0 });
    expect(await (await get("pot-1")).json()).toEqual({ total: null, lines: [] });
  });

  it("won't clear the total of a pot that's saving toward a date", async () => {
    await pot("pot-1", { targetAmount: 100, targetDate: "2027-07-01" });
    const res = await put("pot-1", { total: null, lines: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("pots.budget.err.totalRequiredByDate");
  });

  it("keeps funding when only the total changes", async () => {
    await pot("pot-1", { targetAmount: 100, targetDate: "2027-07-01", funded: 40 });
    await put("pot-1", { total: 150, lines: [] });
    const { rows } = await testDb.client.execute(`SELECT target_amount, funded_amount FROM transaction_groups`);
    expect(rows[0]).toMatchObject({ target_amount: 150, funded_amount: 40 });
  });

  it("rejects a body that isn't a budget", async () => {
    await pot("pot-1");
    expect((await put("pot-1", "nope")).status).toBe(400);
  });
});

describe("GET /api/pots/[id]/details — budget", () => {
  it("spreads the pot's spending over its lines", async () => {
    await pot("pot-1");
    await put("pot-1", VACATION);
    await tx(1000, "pot-1", null, "internal_transfer"); // funding: not spending
    await tx(-420, "pot-1", "c-flights");
    await tx(-900, "pot-1", "c-hotel");
    await tx(-150, "pot-1", "c-food");
    await tx(20, "pot-1", "c-food"); // refund
    await tx(-35, "pot-1", "c-gifts"); // no line
    await tx(-12, "pot-1", null); // uncategorized

    const { pot: p, budget, transactions } = await details("pot-1");

    expect(budget.total).toBe(2000);
    expect(budget.spent).toBe(1497);
    expect(p.spentAmount).toBe(1497);
    expect(p.lineCount).toBe(3);
    expect(budget.lines.map((l) => [l.name, l.spent, l.status])).toEqual([
      ["Flights", 420, "exceeded"],
      ["Hotel", 900, "exceeded"],
      ["Food", 130, "ok"],
    ]);
    expect(budget.lines[2].children.map((c) => [c.name, c.spent])).toEqual([
      ["Dining", 130],
      ["Snacks", 0],
    ]);
    expect(budget.unplanned).toEqual({
      spent: 47,
      groups: [
        { categoryId: "c-gifts", spent: 35 },
        { categoryId: null, spent: 12 },
      ],
    });
    expect(budget.worstLine).toMatchObject({ name: "Hotel", overBy: 100 });
    // Each linked row carries its category so the dialog can label its line.
    expect(transactions.find((t) => t.amount === -420)?.categoryId).toBe("c-flights");
  });

  it("returns an empty budget for a pot that has none", async () => {
    await pot("pot-1");
    await tx(-10, "pot-1", "c-hotel");

    const { budget } = await details("pot-1");

    expect(budget).toMatchObject({ total: null, spent: 10, remaining: null, lines: [] });
  });

  it("reports whether the pot is archived", async () => {
    await pot("pot-1");
    await testDb.client.execute({ sql: `UPDATE transaction_groups SET archived_at = ?`, args: [NOW] });

    expect((await details("pot-1")).pot.archivedAt).toBe(NOW);
  });
});
