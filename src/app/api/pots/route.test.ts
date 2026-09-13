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
