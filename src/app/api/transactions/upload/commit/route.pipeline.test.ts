import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

// Characterization tests: they pin what the CSV commit does today, so the
// import pipeline can be moved into src/lib/import without changing it.

const USER = "commit-route-pipeline-user";

vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("commit-route-pipeline");
});
afterAll(async () => {
  await testDb.cleanup();
});

const now = () => new Date().toISOString();

async function exec(sql: string, args: (string | number | null)[] = []) {
  return testDb.client.execute({ sql, args });
}

beforeEach(async () => {
  await testDb.reset();
  await exec(
    `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [USER, USER, "commit-route-pipeline@test.dev", Date.now(), Date.now()],
  );
  for (const [id, name, iban] of [
    ["acc-check", "Checking", "NL01BANK0000000001"],
    ["acc-save", "Savings", "NL01BANK0000000002"],
  ]) {
    await exec(
      `INSERT INTO accounts (id, user_id, name, type, iban, currency, initial_balance, internal_transfers, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'checking', ?, 'EUR', 0, 1, 0, ?, ?)`,
      [id, USER, name, iban, now(), now()],
    );
  }
  for (const [id, name, kind] of [
    ["cat-groceries", "Groceries", "expense"],
    ["cat-salary", "Salary", "income"],
    ["cat-transfer", "Internal Transfer", "transfer"],
    ["cat-fun", "Fun", "expense"],
  ]) {
    await exec(
      `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, USER, name, kind, now()],
    );
  }
  await exec(
    `INSERT INTO category_rules (id, user_id, pattern, category_id, match_type, match_field, is_active, created_at)
     VALUES ('rule-ah', ?, 'albert heijn', 'cat-groceries', 'contains', 'both', 1, ?)`,
    [USER, now()],
  );
});

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return {
    tempId: crypto.randomUUID(),
    date: "2026-09-01",
    name: "Albert Heijn",
    description: "Albert Heijn 1234",
    amount: -25.5,
    balance: 974.5,
    type: "expense",
    categoryId: "cat-groceries",
    ...overrides,
  };
}

async function commit(body: Row) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://x/api/transactions/upload/commit", {
      method: "POST",
      body: JSON.stringify({ accountId: "acc-check", fileName: "sept.csv", newRules: [], ...body }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  );
  return { status: res.status, json: (await res.json()) as Row };
}

async function txRows(where = "1=1", args: (string | number | null)[] = []) {
  return (
    await exec(`SELECT * FROM transactions WHERE ${where} ORDER BY date, amount, created_at`, args)
  ).rows as unknown as Row[];
}

describe("POST /api/transactions/upload/commit", () => {
  it("inserts rows, records the batch and marks rule-picked categories as rule", async () => {
    const { status, json } = await commit({
      transactions: [
        row(),
        row({ name: "Cinema", description: "Pathe", amount: -12, balance: 962.5, categoryId: "cat-fun" }),
      ],
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, imported: 2, duplicatesSkipped: 0, mirrorTransactions: 0 });

    const rows = await txRows();
    expect(rows).toHaveLength(2);
    const ah = rows.find((r) => r.name === "Albert Heijn")!;
    const cinema = rows.find((r) => r.name === "Cinema")!;
    expect(ah.category_source).toBe("rule");
    expect(cinema.category_source).toBe("manual");
    expect(ah.import_batch_id).toBe(json.batchId);
    expect(ah.user_id).toBe(USER);
    expect(ah.created_by).toBe(USER);

    const batches = (await exec("SELECT * FROM import_batches")).rows;
    expect(batches).toHaveLength(1);
    expect(batches[0].file_name).toBe("sept.csv");
    expect(batches[0].transaction_count).toBe(2);
  });

  it("skips rows already in the account and writes nothing for a full re-import", async () => {
    const body = { transactions: [row(), row({ date: "2026-09-02", amount: -10, balance: 964.5 })] };
    expect((await commit(body)).json.imported).toBe(2);

    const again = await commit({
      transactions: [row(), row({ date: "2026-09-02", amount: -10, balance: 964.5 })],
    });
    expect(again.json).toMatchObject({ imported: 0, duplicatesSkipped: 2 });
    expect(await txRows()).toHaveLength(2);
    expect((await exec("SELECT * FROM import_batches")).rows).toHaveLength(1);
  });

  it("writes a mirror into the target account for a transfer", async () => {
    const { json } = await commit({
      transactions: [
        row({
          name: "Savings",
          description: "To savings",
          amount: -100,
          balance: 900,
          type: "internal_transfer",
          categoryId: "cat-transfer",
          targetAccountId: "acc-save",
          counterpartyIban: "NL01BANK0000000002",
        }),
      ],
    });
    expect(json).toMatchObject({ imported: 1, mirrorTransactions: 1 });

    const [source] = await txRows("account_id = 'acc-check'");
    const [mirror] = await txRows("account_id = 'acc-save'");
    expect(source.type).toBe("internal_transfer");
    expect(source.linked_transaction_id).toBe(mirror.id);
    expect(mirror).toMatchObject({
      amount: 100,
      is_mirror: 1,
      is_manual: 1,
      balance: null,
      import_batch_id: null,
      linked_transaction_id: source.id,
      counterparty_iban: "NL01BANK0000000001",
    });
  });

  it("pairs a transfer with the far leg already imported instead of minting a mirror", async () => {
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
       VALUES ('far-leg', ?, 'acc-save', '2026-09-02', 'From checking', 100, 'income', ?)`,
      [USER, now()],
    );
    const { json } = await commit({
      transactions: [
        row({
          description: "To savings",
          amount: -100,
          balance: 900,
          type: "internal_transfer",
          categoryId: "cat-transfer",
          targetAccountId: "acc-save",
        }),
      ],
    });
    expect(json).toMatchObject({ imported: 1, mirrorTransactions: 0 });
    const [far] = await txRows("id = 'far-leg'");
    const [source] = await txRows("account_id = 'acc-check'");
    expect(far).toMatchObject({ type: "internal_transfer", linked_transaction_id: source.id, category_id: "cat-transfer" });
    expect(source.linked_transaction_id).toBe("far-leg");
  });

  it("absorbs a mirror another import left in this account", async () => {
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, category_id, linked_transaction_id, is_manual, is_mirror, created_at)
       VALUES ('src', ?, 'acc-save', '2026-09-01', 'To checking', -40, 'internal_transfer', 'cat-transfer', 'mirror', 0, 0, ?),
              ('mirror', ?, 'acc-check', '2026-09-01', 'To checking', 40, 'internal_transfer', 'cat-transfer', 'src', 1, 1, ?)`,
      [USER, now(), USER, now()],
    );
    const { json } = await commit({
      transactions: [row({ name: "Me", description: "From savings", amount: 40, balance: 1040, type: "income", categoryId: null })],
    });
    expect(json).toMatchObject({ imported: 0, mirrorsAbsorbed: 1 });
    const rows = await txRows("account_id = 'acc-check'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "mirror",
      is_mirror: 0,
      is_manual: 0,
      balance: 1040,
      description: "From savings",
      type: "internal_transfer",
      import_batch_id: json.batchId,
    });
  });

  it("splits a row into a wrapper and children", async () => {
    await commit({
      transactions: [
        row({
          categoryId: null,
          splits: [
            { amount: -20, categoryId: "cat-groceries" },
            { amount: -5.5, categoryId: "cat-fun" },
          ],
        }),
      ],
    });
    const [parent] = await txRows("parent_transaction_id IS NULL");
    const children = await txRows("parent_transaction_id IS NOT NULL");
    expect(parent).toMatchObject({ is_split_parent: 1, category_id: null });
    expect(children.map((c) => [c.amount, c.category_id, c.category_source])).toEqual([
      [-20, "cat-groceries", "manual"],
      [-5.5, "cat-fun", "manual"],
    ]);
    expect(children.every((c) => c.parent_transaction_id === parent.id)).toBe(true);
  });

  it("links a reimbursement to an expense in the same import", async () => {
    const expense = row({ name: "Dinner", description: "Restaurant", amount: -60, balance: 940, categoryId: "cat-fun" });
    await commit({
      transactions: [
        expense,
        row({
          name: "Friend",
          description: "Tikkie dinner",
          amount: 30,
          balance: 970,
          type: "reimbursement",
          categoryId: null,
          reimbursesTempId: expense.tempId,
        }),
      ],
    });
    const links = (await exec("SELECT * FROM reimbursement_links")).rows;
    const [dinner] = await txRows("name = 'Dinner'");
    const [friend] = await txRows("name = 'Friend'");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ reimbursement_id: friend.id, expense_id: dinner.id });
  });

  it("creates new rules and applies them to existing uncategorized rows", async () => {
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, name, description, amount, type, created_at)
       VALUES ('old-jumbo', ?, 'acc-check', '2026-08-01', 'Jumbo', 'Jumbo 22', -9, 'expense', ?)`,
      [USER, now()],
    );
    const { json } = await commit({
      transactions: [row({ name: "Jumbo", description: "Jumbo 23", amount: -11, balance: 989 })],
      newRules: [{ pattern: "jumbo", categoryId: "cat-groceries", matchType: "contains" }],
    });
    expect(json).toMatchObject({ rulesCreated: 1, existingUpdated: 1 });
    const [old] = await txRows("id = 'old-jumbo'");
    expect(old).toMatchObject({ category_id: "cat-groceries", category_source: "rule" });
  });

  it("detects transfers between plain rows after the import", async () => {
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, counterparty_iban, created_at)
       VALUES ('save-in', ?, 'acc-save', '2026-09-01', 'From checking', 75, 'income', 'NL01BANK0000000001', ?)`,
      [USER, now()],
    );
    const { json } = await commit({
      transactions: [
        row({ description: "To savings", amount: -75, balance: 925, categoryId: null, counterpartyIban: "NL01BANK0000000002" }),
      ],
    });
    expect(json.transfersDetected).toBe(1);
    const [incoming] = await txRows("id = 'save-in'");
    expect(incoming.type).toBe("internal_transfer");
  });

  it("rejects an invalid row without writing anything", async () => {
    const { status } = await commit({
      transactions: [row(), row({ date: "not-a-date" })],
    });
    expect(status).toBe(400);
    expect(await txRows()).toHaveLength(0);
    expect((await exec("SELECT * FROM import_batches")).rows).toHaveLength(0);
  });

  it("keeps the recurring link on an expense row", async () => {
    await exec(
      `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, start_date, created_at)
       VALUES ('plan-rent', ?, 'acc-check', 'Rent', -900, 'expense', 'monthly', '2026-01-01', ?)`,
      [USER, now()],
    );
    await commit({
      transactions: [row({ name: "Landlord", description: "Rent", amount: -900, balance: 100, categoryId: null, recurringTransactionId: "plan-rent" })],
    });
    const [rent] = await txRows();
    expect(rent.recurring_transaction_id).toBe("plan-rent");
  });
});
