import { describe, it, expect, afterAll } from "vitest";
import { setupTestDb } from "@/lib/test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("tenant-guard");

const { db, adminDb, assertTenantScoped } = await import("@/db");
const { transactions } = await import("@/db/schema");
const { eq, sql } = await import("drizzle-orm");

afterAll(() => testDb.cleanup());

describe("assertTenantScoped", () => {
  it("refuses DML on tenant tables without user_id", () => {
    expect(() => assertTenantScoped("SELECT * FROM transactions")).toThrow(/unscoped/i);
    expect(() => assertTenantScoped("DELETE FROM accounts WHERE id = ?")).toThrow(/unscoped/i);
    expect(() =>
      assertTenantScoped({ sql: "UPDATE categories SET name = ?", args: ["x"] }),
    ).toThrow(/unscoped/i);
  });

  it("allows tenant-table DML that names user_id", () => {
    expect(() =>
      assertTenantScoped("SELECT * FROM transactions WHERE user_id = ?"),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped('INSERT INTO accounts (id, user_id, name) VALUES (?, ?, ?)'),
    ).not.toThrow();
  });

  it("ignores DDL and non-tenant tables", () => {
    expect(() => assertTenantScoped("CREATE TABLE transactions (id TEXT)")).not.toThrow();
    expect(() => assertTenantScoped("PRAGMA foreign_keys = ON")).not.toThrow();
    // better-auth's `user`/`session`/`account` (singular) tables are cross-user
    // by design and must stay reachable through the guarded handle.
    expect(() => assertTenantScoped('SELECT * FROM "user" WHERE email = ?')).not.toThrow();
    expect(() => assertTenantScoped("SELECT * FROM account WHERE user_id = ?")).not.toThrow();
  });

  it("does not misfire on tables whose names embed a tenant table name", () => {
    expect(() =>
      assertTenantScoped("SELECT account_id FROM recurring_transactions WHERE user_id = ?"),
    ).not.toThrow();
  });
});

// Drizzle wraps driver errors ("Failed query: …") and keeps ours as `cause`.
const guardRefused = (e: unknown) =>
  /unscoped/i.test(String((e as Error).cause ?? e));

describe("guarded db handle", () => {
  it("throws on an unscoped query against a tenant table", async () => {
    await expect(
      db.run(sql`SELECT COUNT(*) FROM transactions`),
    ).rejects.toSatisfy(guardRefused);
  });

  it("runs scoped queries and unguarded adminDb queries", async () => {
    await expect(
      db.select().from(transactions).where(eq(transactions.userId, "u1")),
    ).resolves.toEqual([]);
    await expect(adminDb.select().from(transactions)).resolves.toEqual([]);
  });

  it("guards statements inside db.transaction()", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run(sql`DELETE FROM transactions`);
      }),
    ).rejects.toSatisfy(guardRefused);
  });
});
