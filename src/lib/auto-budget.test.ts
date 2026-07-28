import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createClient, type Client } from "@libsql/client";

// Point the lazy db proxy at a per-process temp file BEFORE importing anything
// that touches `@/db`. The proxy in src/db/index.ts only opens its connection
// on first access, so as long as TURSO_DATABASE_URL is set before any query
// runs, the proxy and the schema-setup client below share the same file.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `fintrack-auto-budget-${process.pid}-${Date.now()}.db`,
);
process.env.TURSO_DATABASE_URL = `file:${TEST_DB_PATH}`;

import {
  isRegenerationDue,
  regenerateBudgetSuggestions,
  roundUpToFive,
} from "./auto-budget";

const TEST_USER_ID = "test-user";
const OTHER_USER_ID = "other-user";

let client: Client;

async function exec(stmt: string) {
  await client.execute(stmt);
}

async function createSchema() {
  // Auth tables — only the parts referenced via FK by data tables. We skip
  // most columns since the production schema also uses ON DELETE CASCADE etc.
  await exec(`CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT, email TEXT, email_verified INTEGER,
    username TEXT, display_username TEXT, role TEXT,
    created_at INTEGER, updated_at INTEGER
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    bank_name TEXT, iban TEXT,
    currency TEXT NOT NULL DEFAULT 'EUR',
    initial_balance REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    icon TEXT, color TEXT,
    kind TEXT NOT NULL DEFAULT 'spending',
    created_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    balance REAL,
    category_id TEXT,
    type TEXT NOT NULL,
    linked_transaction_id TEXT,
    reimburses_transaction_id TEXT,
    notes TEXT,
    is_manual INTEGER NOT NULL DEFAULT 0,
    import_batch_id TEXT,
    group_id TEXT,
    created_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS recurring_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    category_id TEXT,
    frequency TEXT NOT NULL,
    day_of_week INTEGER, day_of_month INTEGER, month_of_year INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    amount REAL NOT NULL,
    period TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL DEFAULT 'manual',
    generated_at TEXT,
    created_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS reimbursement_links (
    id TEXT PRIMARY KEY,
    reimbursement_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS transaction_groups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category_id TEXT,
    target_amount REAL,
    target_date TEXT,
    funded_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS stat_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  )`);
}

async function seedFixtures() {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [TEST_USER_ID, "Test User", "test@example.com", "user", Date.now(), Date.now()],
  });
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [OTHER_USER_ID, "Other User", "other@example.com", "user", Date.now(), Date.now()],
  });
  await client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ["acct-1", TEST_USER_ID, "Test", "checking", "EUR", 0, 0, now, now],
  });
}

async function clearTransactionalState() {
  await exec(`DELETE FROM reimbursement_links`);
  await exec(`DELETE FROM transactions`);
  await exec(`DELETE FROM transaction_groups`);
  await exec(`DELETE FROM budgets`);
  await exec(`DELETE FROM recurring_transactions`);
  await exec(`DELETE FROM categories`);
}

async function insertCategory(id: string, name: string, color = "#000") {
  await client.execute({
    sql: `INSERT INTO categories (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, TEST_USER_ID, name, color, new Date().toISOString()],
  });
}

interface InsertTxOpts {
  id?: string;
  date: string;
  amount: number;
  categoryId: string | null;
  type?: "expense" | "income" | "reimbursement";
  groupId?: string | null;
  userId?: string;
}

async function insertTransaction(opts: InsertTxOpts) {
  const id = opts.id ?? crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, category_id, type, group_id, is_manual, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      id,
      opts.userId ?? TEST_USER_ID,
      "acct-1",
      opts.date,
      "test",
      opts.amount,
      opts.categoryId,
      opts.type ?? "expense",
      opts.groupId ?? null,
      new Date().toISOString(),
    ],
  });
  return id;
}

async function insertRecurring(categoryId: string, isActive = true) {
  await client.execute({
    sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, category_id, frequency, start_date, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      TEST_USER_ID,
      "acct-1",
      "rent",
      -100,
      "expense",
      categoryId,
      "monthly",
      "2020-01-01",
      isActive ? 1 : 0,
      new Date().toISOString(),
    ],
  });
}

async function insertBudget(opts: {
  categoryId: string;
  amount: number;
  status?: "active" | "suggested";
  isActive?: boolean;
}) {
  const id = crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO budgets (id, user_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES (?, ?, ?, ?, 'monthly', ?, ?, 'manual', ?)`,
    args: [
      id,
      TEST_USER_ID,
      opts.categoryId,
      opts.amount,
      opts.isActive === false ? 0 : 1,
      opts.status ?? "active",
      new Date().toISOString(),
    ],
  });
  return id;
}

function pastMonthDate(monthsAgo: number, day = 15): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}

describe("roundUpToFive", () => {
  it("returns 0 unchanged", () => {
    expect(roundUpToFive(0)).toBe(0);
  });

  it("returns multiples of 5 unchanged", () => {
    expect(roundUpToFive(5)).toBe(5);
    expect(roundUpToFive(50)).toBe(50);
  });

  it("rounds up just-over values to the next 5", () => {
    expect(roundUpToFive(5.0001)).toBe(10);
    expect(roundUpToFive(7.42)).toBe(10);
  });

  it("clamps negatives to 0", () => {
    expect(roundUpToFive(-3)).toBe(0);
    expect(roundUpToFive(-100)).toBe(0);
  });
});

describe("isRegenerationDue", () => {
  it("is due when there is no last check", () => {
    expect(isRegenerationDue(null, 1)).toBe(true);
  });

  it("is due when the ISO string is malformed", () => {
    expect(isRegenerationDue("not-a-date", 1)).toBe(true);
  });

  it("is NOT due when the last check was just now", () => {
    expect(isRegenerationDue(new Date().toISOString(), 1)).toBe(false);
  });

  it("is due when the last check is older than the interval", () => {
    const fiveMonthsAgo = new Date();
    fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);
    expect(isRegenerationDue(fiveMonthsAgo.toISOString(), 1)).toBe(true);
    expect(isRegenerationDue(fiveMonthsAgo.toISOString(), 3)).toBe(true);
  });

  it("treats interval < 1 as 1 month minimum", () => {
    const halfMonthAgo = new Date();
    halfMonthAgo.setDate(halfMonthAgo.getDate() - 15);
    expect(isRegenerationDue(halfMonthAgo.toISOString(), 0)).toBe(false);
  });
});

describe("regenerateBudgetSuggestions", () => {
  beforeAll(async () => {
    client = createClient({ url: `file:${TEST_DB_PATH}` });
    await createSchema();
    await seedFixtures();
  });

  afterAll(async () => {
    client.close();
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {
      /* best effort */
    }
  });

  beforeEach(async () => {
    await clearTransactionalState();
  });

  it("rejects out-of-range lookbackMonths instead of silently clamping", async () => {
    await expect(regenerateBudgetSuggestions(TEST_USER_ID, 0)).rejects.toThrow(
      /lookbackMonths/,
    );
    await expect(regenerateBudgetSuggestions(TEST_USER_ID, 13)).rejects.toThrow(
      /lookbackMonths/,
    );
  });

  it("uses monthsObserved (not lookback) for the average", async () => {
    // 1 month of data, lookback = 3 → divisor must be 1, suggestion = 100.
    await insertCategory("cat-coffee", "Coffee");
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -100,
      categoryId: "cat-coffee",
    });

    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].avgMonthly).toBe(100);
    expect(suggestions[0].suggestedAmount).toBe(100);
    expect(suggestions[0].monthsOfData).toBe(1);
  });

  it("rounds the average up to the nearest 5", async () => {
    await insertCategory("cat-1", "X");
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -42.3,
      categoryId: "cat-1",
    });
    const [s] = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(s.avgMonthly).toBe(42.3);
    expect(s.suggestedAmount).toBe(45);
  });

  it("skips categories already covered by an active recurring expense", async () => {
    await insertCategory("cat-rent", "Rent");
    await insertCategory("cat-food", "Food");
    await insertRecurring("cat-rent", true);
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -800,
      categoryId: "cat-rent",
    });
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -100,
      categoryId: "cat-food",
    });

    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(suggestions.map((s) => s.categoryId)).toEqual(["cat-food"]);
  });

  it("does not skip categories whose recurring is inactive", async () => {
    await insertCategory("cat-x", "X");
    await insertRecurring("cat-x", false);
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -50,
      categoryId: "cat-x",
    });
    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(suggestions).toHaveLength(1);
  });

  it("skips categories where the active budget already matches the suggestion", async () => {
    await insertCategory("cat-match", "Match");
    await insertCategory("cat-diff", "Diff");
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -100,
      categoryId: "cat-match",
    });
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -100,
      categoryId: "cat-diff",
    });
    // active budget already at 100 → skip
    await insertBudget({ categoryId: "cat-match", amount: 100 });
    // active budget at 50 → still suggest 100
    await insertBudget({ categoryId: "cat-diff", amount: 50 });

    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(suggestions.map((s) => s.categoryId)).toEqual(["cat-diff"]);
    expect(suggestions[0].currentAmount).toBe(50);
  });

  it("excludes pot/grouped transactions from the totals", async () => {
    await insertCategory("cat-pot", "Pot");
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -100,
      categoryId: "cat-pot",
      groupId: "some-pot",
    });
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -50,
      categoryId: "cat-pot",
      groupId: null,
    });
    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].avgMonthly).toBe(50);
  });

  it("subtracts reimbursements from the total", async () => {
    await insertCategory("cat-r", "R");
    const expenseId = await insertTransaction({
      date: pastMonthDate(1),
      amount: -100,
      categoryId: "cat-r",
    });
    const reimbId = await insertTransaction({
      date: pastMonthDate(1),
      amount: 30,
      categoryId: "cat-r",
      type: "reimbursement",
    });
    await client.execute({
      sql: `INSERT INTO reimbursement_links (id, reimbursement_id, expense_id, created_at) VALUES (?, ?, ?, ?)`,
      args: [crypto.randomUUID(), reimbId, expenseId, new Date().toISOString()],
    });

    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(suggestions).toHaveLength(1);
    // 100 - 30 = 70 → roundUpToFive = 70
    expect(suggestions[0].avgMonthly).toBe(70);
    expect(suggestions[0].suggestedAmount).toBe(70);
  });

  it("deletes prior status='suggested' rows before inserting fresh ones", async () => {
    await insertCategory("cat-stale", "Stale");
    await insertCategory("cat-new", "New");
    // Old suggestion that should be wiped:
    await insertBudget({
      categoryId: "cat-stale",
      amount: 999,
      status: "suggested",
      isActive: false,
    });
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -25,
      categoryId: "cat-new",
    });

    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    const all = await client.execute({
      sql: `SELECT category_id FROM budgets WHERE user_id = ? AND status = 'suggested'`,
      args: [TEST_USER_ID],
    });
    expect(suggestions.map((s) => s.categoryId)).toEqual(["cat-new"]);
    expect(all.rows.map((r) => r.category_id)).toEqual(["cat-new"]);
  });

  it("does not mix users", async () => {
    await insertCategory("cat-mine", "Mine");
    await insertTransaction({
      date: pastMonthDate(1),
      amount: -50,
      categoryId: "cat-mine",
      userId: OTHER_USER_ID,
    });
    const suggestions = await regenerateBudgetSuggestions(TEST_USER_ID, 3);
    expect(suggestions).toHaveLength(0);
  });
});
