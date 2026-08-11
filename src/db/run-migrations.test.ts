import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the lazy `@/db` proxy (used by initializeDatabase) and the migration
// runner at one temp file BEFORE anything touches the DB. The proxy caches its
// first connection, so every case in this file must share this one file.
const dbPath = path.join(os.tmpdir(), `fintrack-migrate-${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

const { runMigrations } = await import("./run-migrations");

// The migrator resolves the folder from cwd (repo root under vitest).
const journal = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
) as { entries: { when: number }[] };
const baselineWhen = journal.entries[0].when;
const migrationCount = journal.entries.length;

let client: Client;
const tableNames = async () =>
  (await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(
    (r) => r.name as string,
  );
const columnNames = async (table: string) =>
  (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name as string);

beforeAll(() => {
  client = createClient({ url: `file:${dbPath}` });
});
afterAll(() => {
  client.close();
  fs.rmSync(dbPath, { force: true });
});

describe("run-migrations pipeline", () => {
  it("applies migrations to a fresh database", async () => {
    await runMigrations();

    const tables = await tableNames();
    // A representative slice of the 17 schema tables + the drizzle ledger.
    for (const t of ["user", "transactions", "user_preferences", "accounts", "categories"]) {
      expect(tables).toContain(t);
    }
    expect(tables).toContain("__drizzle_migrations");

    // The column whose absence took prod down must exist after migrating.
    expect(await columnNames("user_preferences")).toContain("hide_internal_transfers");

    // Every journal entry recorded once, the oldest stamped at 0000's journal
    // timestamp so the migrator skips it but still runs any future migration.
    const ledger = await client.execute(
      "SELECT count(*) n, min(created_at) w FROM __drizzle_migrations",
    );
    expect(Number(ledger.rows[0].n)).toBe(migrationCount);
    expect(Number(ledger.rows[0].w)).toBe(baselineWhen);

    // initializeDatabase seeds the admin user.
    const users = await client.execute('SELECT count(*) n FROM "user"');
    expect(Number(users.rows[0].n)).toBeGreaterThan(0);

    // Regression: the recurring backfill (correlated `transactions.amount` in a
    // subquery ORDER BY) used to throw and never write its one-time marker.
    // If it completes, the marker is present.
    const marker = await client.execute(
      "SELECT 1 FROM one_time_migrations WHERE name = 'recurring_link_backfill_v1'",
    );
    expect(marker.rows.length).toBe(1);
  });

  it("is idempotent on re-run", async () => {
    await expect(runMigrations()).resolves.not.toThrow();
    const ledger = await client.execute("SELECT count(*) n FROM __drizzle_migrations");
    expect(Number(ledger.rows[0].n)).toBe(migrationCount);
  });

  it("baselines a pre-migration database and repairs column drift", async () => {
    // Simulate old prod: app tables exist, but no drizzle ledger, none of the
    // post-baseline migrations applied, and a column missing.
    await client.execute("DROP TABLE __drizzle_migrations");
    await client.execute("ALTER TABLE user_preferences DROP COLUMN hide_internal_transfers");
    await client.execute("ALTER TABLE user_preferences DROP COLUMN locale");
    await client.execute("ALTER TABLE user_preferences DROP COLUMN simple_mode");
    await client.execute("ALTER TABLE transaction_groups DROP COLUMN archived_at");
    await client.execute("ALTER TABLE accounts DROP COLUMN bank");
    await client.execute("ALTER TABLE categories DROP COLUMN sort_order");
    await client.execute("DROP TABLE stat_resets");
    await client.execute("DROP TABLE app_settings");
    await client.execute("DROP TABLE rate_limit");
    await client.execute("DROP TABLE invites");
    await client.execute("DROP TABLE twoFactor");
    await client.execute("ALTER TABLE user DROP COLUMN two_factor_enabled");
    // Old prod still has the username columns 0013 collapses into `name`.
    await client.execute("ALTER TABLE user ADD COLUMN username TEXT");
    await client.execute("ALTER TABLE user ADD COLUMN display_username TEXT");
    await client.execute("DROP INDEX idx_budgets_plan");
    await client.execute("ALTER TABLE budgets DROP COLUMN budget_id");
    await client.execute("ALTER TABLE accounts DROP COLUMN budget_id");
    await client.execute("ALTER TABLE user_preferences DROP COLUMN count_cross_budget_transfers");
    await client.execute("DROP TABLE budget_plans");
    // Created by 0014, alongside the yearly columns on budget_plans.
    await client.execute("DROP TABLE budget_ledger");
    await client.execute("DROP TABLE budget_ledger_jobs");
    expect(await columnNames("user_preferences")).not.toContain("hide_internal_transfers");

    // Pre-0009 data for the backfill: checking, joint and savings accounts
    // plus a budget row. 0009 must create a Main plan owning the two budgetable
    // accounts and the budget row, and leave savings unassigned.
    const [{ id: seededUserId }] = (
      await client.execute('SELECT id FROM "user" LIMIT 1')
    ).rows as unknown as { id: string }[];
    const nowIso = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
            VALUES ('mig-check', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?),
                   ('mig-joint', ?, 'Joint', 'joint', 'EUR', 0, 1, ?, ?),
                   ('mig-save', ?, 'Savings', 'savings', 'EUR', 0, 2, ?, ?)`,
      args: [
        seededUserId, nowIso, nowIso,
        seededUserId, nowIso, nowIso,
        seededUserId, nowIso, nowIso,
      ],
    });
    await client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('mig-cat', ?, 'Migration Test Cat', ?)`,
      args: [seededUserId, nowIso],
    });
    await client.execute({
      sql: `INSERT INTO budgets (id, user_id, category_id, amount, period, is_active, status, source, created_at)
            VALUES ('mig-budget', ?, 'mig-cat', 100, 'monthly', 1, 'active', 'manual', ?)`,
      args: [seededUserId, nowIso],
    });

    // Must not error on the existing tables (no "table already exists").
    await expect(runMigrations()).resolves.not.toThrow();

    // 0009 backfill: one Main plan per user with data, the budgetable accounts
    // attached, savings not, and the legacy budget row adopted into the plan.
    const plansRows = (
      await client.execute({
        sql: "SELECT id, name, is_main FROM budget_plans WHERE user_id = ?",
        args: [seededUserId],
      })
    ).rows as unknown as { id: string; name: string; is_main: number }[];
    expect(plansRows).toHaveLength(1);
    expect(plansRows[0].name).toBe("Main");
    expect(Number(plansRows[0].is_main)).toBe(1);
    const acctRows = (
      await client.execute(
        "SELECT id, budget_id FROM accounts WHERE id IN ('mig-check', 'mig-joint', 'mig-save')",
      )
    ).rows as unknown as { id: string; budget_id: string | null }[];
    expect(acctRows.find((r) => r.id === "mig-check")?.budget_id).toBe(plansRows[0].id);
    // Joint accounts are budgetable (BUDGETABLE_ACCOUNT_TYPES) — leaving them
    // out gave joint-only users an empty Main plan reading €0 spent.
    expect(acctRows.find((r) => r.id === "mig-joint")?.budget_id).toBe(plansRows[0].id);
    expect(acctRows.find((r) => r.id === "mig-save")?.budget_id).toBeNull();
    const budgetRow = (
      await client.execute("SELECT budget_id FROM budgets WHERE id = 'mig-budget'")
    ).rows[0] as unknown as { budget_id: string | null };
    expect(budgetRow.budget_id).toBe(plansRows[0].id);

    const ledger = await client.execute(
      "SELECT count(*) n, min(created_at) w FROM __drizzle_migrations",
    );
    expect(Number(ledger.rows[0].n)).toBe(migrationCount);
    expect(Number(ledger.rows[0].w)).toBe(baselineWhen);
    // 0001–0004 re-applied on top of the baseline.
    expect(await columnNames("transaction_groups")).toContain("archived_at");
    expect(await columnNames("accounts")).toContain("bank");
    expect(await columnNames("categories")).toContain("sort_order");
    expect(await tableNames()).toContain("stat_resets");
    expect(await tableNames()).toContain("app_settings");
    expect(await tableNames()).toContain("rate_limit");
    expect(await tableNames()).toContain("invites");
    expect(await tableNames()).toContain("twoFactor");
    expect(await columnNames("user")).toContain("two_factor_enabled");
    expect(await columnNames("user")).not.toContain("username");
    expect(await columnNames("user")).not.toContain("display_username");
    expect(await columnNames("user_preferences")).toContain("hide_internal_transfers");
    expect(await tableNames()).toContain("budget_plans");
    expect(await columnNames("accounts")).toContain("budget_id");
    expect(await columnNames("budgets")).toContain("budget_id");
    expect(await columnNames("user_preferences")).toContain("count_cross_budget_transfers");
  });
});
