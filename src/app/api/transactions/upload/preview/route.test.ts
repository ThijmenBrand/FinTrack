import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

// Characterization tests for the CSV preview: parsing stays in the route,
// classification moved to src/lib/import/classify — the output must not change.

const USER = "preview-route-user";

vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("preview-route");
});
afterAll(async () => {
  await testDb.cleanup();
});

const now = () => new Date().toISOString();
const exec = (sql: string, args: (string | number | null)[] = []) =>
  testDb.client.execute({ sql, args });

beforeEach(async () => {
  await testDb.reset();
  await exec(
    `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [USER, USER, "preview-route@test.dev", Date.now(), Date.now()],
  );
  for (const [id, iban] of [
    ["acc-check", "NL01BANK0000000001"],
    ["acc-save", "NL01BANK0000000002"],
  ]) {
    await exec(
      `INSERT INTO accounts (id, user_id, name, type, iban, currency, initial_balance, internal_transfers, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'checking', ?, 'EUR', 0, 1, 0, ?, ?)`,
      [id, USER, id, iban, now(), now()],
    );
  }
  await exec(
    `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES
     ('cat-groceries', ?, 'Groceries', 'expense', ?),
     ('cat-transfer', ?, 'Internal Transfer', 'transfer', ?)`,
    [USER, now(), USER, now()],
  );
  await exec(
    `INSERT INTO category_rules (id, user_id, pattern, category_id, match_type, match_field, is_active, created_at)
     VALUES ('rule-ah', ?, 'albert heijn', 'cat-groceries', 'contains', 'both', 1, ?)`,
    [USER, now()],
  );
  await exec(
    `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, start_date, is_active, match_pattern, match_field, created_at)
     VALUES ('plan-gym', ?, 'acc-check', 'Gym', -30, 'expense', 'monthly', '2026-01-01', 1, 'basic-fit', 'name', ?)`,
    [USER, now()],
  );
});

const CSV = [
  "Date,Name,Description,Amount,Balance,Counterparty",
  "2026-09-01,Albert Heijn,AH 1234,-25.50,974.50,",
  "2026-09-02,Savings,To savings,-100.00,874.50,NL01BANK0000000002",
  "2026-09-03,Basic-Fit,Membership,-30.00,844.50,",
  "2026-09-04,,,,,",
].join("\n");

const MAPPING = {
  date: "Date",
  name: "Name",
  description: "Description",
  amount: "Amount",
  balance: "Balance",
  counterpartyIban: "Counterparty",
};

async function preview(csv = CSV) {
  const { POST } = await import("./route");
  const form = new FormData();
  form.set("file", new File([csv], "sept.csv", { type: "text/csv" }));
  form.set("accountId", "acc-check");
  form.set("mapping", JSON.stringify(MAPPING));
  const res = await POST(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Request("http://x/api/transactions/upload/preview", { method: "POST", body: form }) as any,
  );
  return { status: res.status, json: await res.json() };
}

describe("POST /api/transactions/upload/preview", () => {
  it("classifies rows: rules, IBAN transfers, recurring plans", async () => {
    const { status, json } = await preview();
    expect(status).toBe(200);
    expect(json.skipped).toBe(1);
    expect(json.duplicates).toBe(0);
    const rows = json.transactions as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      date: "2026-09-01",
      name: "Albert Heijn",
      description: "AH 1234",
      amount: -25.5,
      balance: 974.5,
      type: "expense",
      categoryId: "cat-groceries",
    });
    expect(rows[1]).toMatchObject({
      type: "internal_transfer",
      categoryId: "cat-transfer",
      targetAccountId: "acc-save",
      counterpartyIban: "NL01BANK0000000002",
    });
    expect(rows[2]).toMatchObject({
      type: "expense",
      categoryId: null,
      recurringTransactionId: "plan-gym",
      recurringDescription: "Gym",
    });
  });

  it("drops rows already in the account", async () => {
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, description, amount, balance, type, created_at)
       VALUES ('t1', ?, 'acc-check', '2026-09-01', 'AH 1234', -25.5, 974.5, 'expense', ?)`,
      [USER, now()],
    );
    const { json } = await preview();
    expect(json.duplicates).toBe(1);
    expect(json.transactions).toHaveLength(2);
  });
});
