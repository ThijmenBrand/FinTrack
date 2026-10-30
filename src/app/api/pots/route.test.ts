/**
 * The pots list, and the two different questions a pot answers.
 *
 * `netAmount` here is "what is in the pot" — every row it holds, funding
 * transfers included. That is deliberately NOT the same figure as the pot
 * spend every budget/insight aggregate uses (`potSpentAmount`), which asks
 * "what did this pot cost this month" and so excludes internal transfers and
 * floors at zero. These tests pin both so the difference stays a choice.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "pots-user";
const OTHER = "pots-other";

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
const TODAY = NOW.slice(0, 10);
let seq = 0;

beforeAll(async () => {
  testDb = await setupTestDb("pots-route");
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
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, color, created_at) VALUES ('cat-1', ?, 'Holiday', '#abcdef', ?)`,
    args: [USER, NOW],
  });
});

const pot = (
  id: string,
  opts: {
    userId?: string;
    categoryId?: string | null;
    targetAmount?: number | null;
    targetDate?: string | null;
    fundedAmount?: number;
    archivedAt?: string | null;
  } = {},
) =>
  testDb.client.execute({
    sql: `INSERT INTO transaction_groups
            (id, user_id, name, category_id, target_amount, target_date, funded_amount, archived_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      opts.userId ?? USER,
      id,
      opts.categoryId ?? null,
      opts.targetAmount ?? null,
      opts.targetDate ?? null,
      opts.fundedAmount ?? 0,
      opts.archivedAt ?? null,
      NOW,
    ],
  });

const tx = (
  amount: number,
  groupId: string | null,
  opts: {
    userId?: string;
    type?: string;
    isSplitParent?: boolean;
    parentTransactionId?: string | null;
    id?: string;
  } = {},
) =>
  testDb.client.execute({
    sql: `INSERT INTO transactions
            (id, user_id, account_id, date, description, amount, type, group_id, is_split_parent, parent_transaction_id, created_at)
          VALUES (?, ?, 'acc-1', ?, 't', ?, ?, ?, ?, ?, ?)`,
    args: [
      opts.id ?? `tx-${++seq}`,
      opts.userId ?? USER,
      TODAY,
      amount,
      opts.type ?? (amount < 0 ? "expense" : "income"),
      groupId,
      opts.isSplitParent ? 1 : 0,
      opts.parentTransactionId ?? null,
      NOW,
    ],
  });

type PotRow = {
  id: string;
  name: string;
  categoryName: string | null;
  netAmount: number;
  transactionCount: number;
  fundedAmount: number;
  targetAmount: number | null;
  archivedAt: string | null;
};

async function list(): Promise<PotRow[]> {
  const { GET } = await import("./route");
  const res = await GET();
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/pots", () => {
  it("reports an empty pot as zero rather than null", async () => {
    await pot("pot-1");

    const [row] = await list();

    expect(row).toMatchObject({ netAmount: 0, transactionCount: 0 });
  });

  it("nets every member row, funding transfers included", async () => {
    await pot("pot-1");
    await tx(-500, "pot-1", { type: "internal_transfer" }); // money out of checking
    await tx(500, "pot-1", { type: "internal_transfer" }); // …into the pot
    await tx(-120, "pot-1"); // spent from it

    const [row] = await list();

    expect(row.netAmount).toBe(-120);
    expect(row.transactionCount).toBe(3);
  });

  it("goes positive for a pot that took in more than it paid out", async () => {
    await pot("pot-1");
    await tx(-40, "pot-1");
    await tx(300, "pot-1");

    const [row] = await list();

    // Not floored: "what is in the pot" can be a credit. The budget views floor
    // their own figure because they ask a different question.
    expect(row.netAmount).toBe(260);
  });

  it("carries the category label and its colour", async () => {
    await pot("pot-1", { categoryId: "cat-1" });

    const [row] = await list();

    expect(row.categoryName).toBe("Holiday");
  });

  it("keeps archived pots in the list, flagged", async () => {
    await pot("pot-live");
    await pot("pot-old", { archivedAt: NOW });

    const rows = await list();

    expect(rows.map((r) => r.id).sort()).toEqual(["pot-live", "pot-old"]);
    expect(rows.find((r) => r.id === "pot-old")!.archivedAt).toBe(NOW);
  });

  it("reports the spike target and what has been put aside", async () => {
    await pot("pot-spike", {
      targetAmount: 1200,
      targetDate: "2026-12-01",
      fundedAmount: 300,
    });

    const [row] = await list();

    expect(row).toMatchObject({ targetAmount: 1200, fundedAmount: 300 });
  });

  it("never counts another user's rows in a pot, nor lists their pots", async () => {
    await pot("pot-mine");
    await pot("pot-theirs", { userId: OTHER });
    // A row belonging to someone else that names this pot must not be summed.
    await tx(-999, "pot-mine", { userId: OTHER });
    await tx(-10, "pot-mine");

    const rows = await list();

    expect(rows.map((r) => r.id)).toEqual(["pot-mine"]);
    expect(rows[0].netAmount).toBe(-10);
  });

  it("sees nothing at all as a different user", async () => {
    await pot("pot-mine");
    actor = OTHER;

    expect(await list()).toEqual([]);
  });
});

const json = (body: unknown, method = "POST") =>
  new Request("http://test/api/pots", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;

async function potRow(id: string) {
  const { rows } = await testDb.client.execute({
    sql: `SELECT target_amount, target_date, funded_amount FROM transaction_groups WHERE id = ?`,
    args: [id],
  });
  return rows[0];
}

async function lineRows(potId: string) {
  const { rows } = await testDb.client.execute({
    sql: `SELECT name, amount, parent_id FROM pot_budget_lines WHERE pot_id = ? ORDER BY sort_order`,
    args: [potId],
  });
  return rows;
}

const seedLines = async (potId: string, lines: { id: string; amount: number; parentId?: string }[]) => {
  for (const [i, l] of lines.entries()) {
    await testDb.client.execute({
      sql: `INSERT INTO pot_budget_lines (id, user_id, pot_id, parent_id, name, amount, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [l.id, USER, potId, l.parentId ?? null, l.id, l.amount, i, NOW],
    });
  }
};

describe("GET /api/pots — budget figures", () => {
  it("reports spending without the funding transfers, floored at zero", async () => {
    await pot("pot-1");
    await tx(500, "pot-1", { type: "internal_transfer" });
    await tx(-120, "pot-1");
    await tx(20, "pot-1"); // a refund
    await pot("pot-2");
    await tx(300, "pot-2");

    const rows = await list();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r as PotRow & { spentAmount: number }]));

    expect(byId["pot-1"].spentAmount).toBe(100);
    expect(byId["pot-2"].spentAmount).toBe(0);
  });

  it("leaves split parents out of spending — their children carry the money", async () => {
    await pot("pot-1");
    await tx(-100, "pot-1", { isSplitParent: true, id: "parent" });
    await tx(-60, "pot-1", { parentTransactionId: "parent" });

    const [row] = (await list()) as (PotRow & { spentAmount: number })[];

    expect(row.spentAmount).toBe(60);
  });

  it("counts top-level budget lines only", async () => {
    await pot("pot-1", { targetAmount: 100 });
    await seedLines("pot-1", [
      { id: "a", amount: 60 },
      { id: "b", amount: 40 },
      { id: "b1", amount: 40, parentId: "b" },
    ]);
    await pot("pot-2");

    const rows = (await list()) as (PotRow & { lineCount: number })[];

    expect(rows.find((r) => r.id === "pot-1")!.lineCount).toBe(2);
    expect(rows.find((r) => r.id === "pot-2")!.lineCount).toBe(0);
  });
});

describe("POST /api/pots", () => {
  const create = async (body: unknown) => {
    const { POST } = await import("./route");
    return POST(json(body));
  };

  it("creates a budget total without a target date", async () => {
    const res = await create({ name: "Kitchen", categoryId: null, targetAmount: 800 });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await potRow(id)).toMatchObject({ target_amount: 800, target_date: null });
  });

  it("refuses a target date without an amount", async () => {
    const res = await create({ name: "Trip", targetDate: "2026-07-01" });
    expect(res.status).toBe(400);
  });

  it("saves the pot and its lines together", async () => {
    const res = await create({
      name: "Vacation",
      targetAmount: 1000,
      targetDate: "2027-07-01",
      lines: [
        { name: "Flights", amount: 400, categoryIds: ["cat-1"], children: [] },
        { name: "Hotel", amount: 600, categoryIds: [], children: [] },
      ],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await lineRows(id)).map((r) => [r.name, r.amount])).toEqual([
      ["Flights", 400],
      ["Hotel", 600],
    ]);
  });

  it("creates nothing when the lines don't add up", async () => {
    const res = await create({
      name: "Vacation",
      targetAmount: 1000,
      lines: [{ name: "Flights", amount: 400, categoryIds: [], children: [] }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("pots.budget.err.sumMismatch");
    expect(await list()).toEqual([]);
  });

  it("refuses another user's category on a line", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-x', ?, 'Theirs', ?)`,
      args: [OTHER, NOW],
    });
    const res = await create({
      name: "Vacation",
      targetAmount: 10,
      lines: [{ name: "A", amount: 10, categoryIds: ["cat-x"], children: [] }],
    });
    expect(res.status).toBe(404);
    expect(await list()).toEqual([]);
  });
});

describe("PUT /api/pots", () => {
  const update = async (body: unknown) => {
    const { PUT } = await import("./route");
    return PUT(json(body, "PUT"));
  };

  it("won't move the total away from its planned lines", async () => {
    await pot("pot-1", { targetAmount: 100 });
    await seedLines("pot-1", [{ id: "a", amount: 60 }, { id: "b", amount: 40 }]);

    const res = await update({ id: "pot-1", targetAmount: 120 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("pots.budget.err.sumMismatch");
    expect((await update({ id: "pot-1", targetAmount: null })).status).toBe(409);
    expect((await potRow("pot-1")).target_amount).toBe(100);

    // Re-sending the same total (e.g. a rename alongside it) is fine.
    expect((await update({ id: "pot-1", name: "Renamed", targetAmount: 100 })).status).toBe(200);
  });

  it("changes the total freely while there are no lines", async () => {
    await pot("pot-1", { targetAmount: 100 });
    expect((await update({ id: "pot-1", targetAmount: 150 })).status).toBe(200);
    expect((await potRow("pot-1")).target_amount).toBe(150);
  });

  it("clearing the date keeps the total but resets funding", async () => {
    await pot("pot-1", { targetAmount: 500, targetDate: "2027-01-01", fundedAmount: 200 });

    expect((await update({ id: "pot-1", targetDate: null })).status).toBe(200);

    expect(await potRow("pot-1")).toMatchObject({ target_amount: 500, target_date: null, funded_amount: 0 });
  });

  it("refuses a date on a pot without a total", async () => {
    await pot("pot-1");
    expect((await update({ id: "pot-1", targetDate: "2027-01-01" })).status).toBe(400);
  });
});

describe("DELETE /api/pots", () => {
  it("removes the pot's budget lines and categories with it", async () => {
    await pot("pot-1", { targetAmount: 100 });
    await pot("pot-2", { targetAmount: 50 });
    await seedLines("pot-1", [{ id: "a", amount: 100 }]);
    await seedLines("pot-2", [{ id: "z", amount: 50 }]);
    await testDb.client.execute({
      sql: `INSERT INTO pot_budget_line_categories (id, user_id, pot_id, line_id, category_id)
            VALUES ('lc-1', ?, 'pot-1', 'a', 'cat-1')`,
      args: [USER],
    });
    await tx(-10, "pot-1", { id: "member" });

    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://test/api/pots?id=pot-1", { method: "DELETE" }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(200);

    expect(await lineRows("pot-1")).toEqual([]);
    expect(await lineRows("pot-2")).toHaveLength(1);
    const { rows: cats } = await testDb.client.execute(`SELECT id FROM pot_budget_line_categories`);
    expect(cats).toEqual([]);
    const { rows: members } = await testDb.client.execute(`SELECT group_id FROM transactions WHERE id = 'member'`);
    expect(members[0].group_id).toBeNull();
  });
});
