import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";
import { db } from "@/db";
import { accounts, type Account } from "@/db/schema";
import { eq } from "drizzle-orm";
import { commitImport, type CommitTransaction } from "./commit";

const USER = "commit-lib-user";

let testDb: TestDb;
let account: Account;

beforeAll(async () => {
  testDb = await setupTestDb("commit-lib");
});
afterAll(async () => {
  await testDb.cleanup();
});

const now = () => new Date().toISOString();

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, USER, "commit-lib@test.dev", Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, iban, currency, initial_balance, internal_transfers, sort_order, created_at, updated_at)
          VALUES ('acc', ?, 'Checking', 'checking', 'NL01BANK0000000001', 'EUR', 0, 1, 0, ?, ?)`,
    args: [USER, now(), now()],
  });
  [account] = await db.select().from(accounts).where(eq(accounts.id, "acc"));
});

function row(overrides: Partial<CommitTransaction> = {}): CommitTransaction {
  return {
    tempId: crypto.randomUUID(),
    date: "2026-09-01",
    name: "Coffee",
    description: "Coffee bar",
    amount: -3,
    balance: null,
    type: "expense",
    categoryId: null,
    ...overrides,
  };
}

const count = async (table: string) =>
  Number((await testDb.client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

describe("commitImport", () => {
  it("rolls every write back when the transaction fails", async () => {
    await expect(
      commitImport({
        actorId: USER,
        account,
        batchLabel: "Bank sync · Test",
        source: "bank_sync",
        transactions: [row({ externalId: "a" }), row({ externalId: "b" })],
        dedupe: "externalId",
        afterWrite: async () => {
          throw new Error("cursor update failed");
        },
      }),
    ).rejects.toThrow("cursor update failed");
    expect(await count("transactions")).toBe(0);
    expect(await count("import_batches")).toBe(0);
  });

  it("keeps identical same-day payments apart by their external id", async () => {
    const result = await commitImport({
      actorId: USER,
      account,
      batchLabel: "Bank sync · Test",
      source: "bank_sync",
      transactions: [row({ externalId: "a" }), row({ externalId: "b" })],
      dedupe: "externalId",
    });
    expect(result).toMatchObject({ ok: true, imported: 2, duplicatesSkipped: 0 });

    const batch = (await testDb.client.execute("SELECT * FROM import_batches")).rows[0];
    expect(batch).toMatchObject({ source: "bank_sync", file_name: "Bank sync · Test" });
  });

  it("skips external ids already in the account", async () => {
    const first = { actorId: USER, account, batchLabel: "x", source: "bank_sync" as const, dedupe: "externalId" as const };
    await commitImport({ ...first, transactions: [row({ externalId: "a" })] });
    const again = await commitImport({
      ...first,
      transactions: [row({ externalId: "a" }), row({ externalId: "c", amount: -4 })],
    });
    expect(again).toMatchObject({ ok: true, imported: 1, duplicatesSkipped: 1 });
    expect(await count("transactions")).toBe(2);
  });

  it("the unique index refuses a duplicate external id even past the dedup", async () => {
    await testDb.client.execute({
      sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, external_id, created_at)
            VALUES ('t0', ?, 'acc', '2026-09-01', 'x', -1, 'expense', 'dup', ?)`,
      args: [USER, now()],
    });
    // "content" dedup does not look at external ids, so only the index stops it.
    await expect(
      commitImport({
        actorId: USER,
        account,
        batchLabel: "x",
        source: "bank_sync",
        transactions: [row({ externalId: "fresh" }), row({ externalId: "dup", amount: -9 })],
      }),
    ).rejects.toThrow();
    // …and nothing of the batch survives, the fresh row included.
    expect(await count("transactions")).toBe(1);
  });
});
