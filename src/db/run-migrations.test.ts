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
    await client.execute("DROP TABLE budget_month_targets");
    // Created by 0015.
    await client.execute("DROP TABLE budget_sub_lines");
    // Created by 0016.
    await client.execute("DROP TABLE account_members");
    await client.execute("ALTER TABLE transactions DROP COLUMN created_by");
    await client.execute("ALTER TABLE transactions DROP COLUMN modified_by");
    await client.execute("ALTER TABLE user_preferences DROP COLUMN main_budget_plan_id");
    // Created by 0017.
    await client.execute("ALTER TABLE category_rules DROP COLUMN match_field");
    // Created by 0018.
    await client.execute("ALTER TABLE transactions DROP COLUMN category_label");
    // Created by 0020. The index goes first — SQLite refuses to drop an indexed
    // column. (0019's owner_share_percent leaves with budget_plans above.)
    await client.execute("DROP INDEX idx_transactions_parent");
    await client.execute("ALTER TABLE transactions DROP COLUMN parent_transaction_id");
    await client.execute("ALTER TABLE transactions DROP COLUMN is_split_parent");
    await client.execute("DROP TABLE split_rule_lines");
    await client.execute("DROP TABLE split_rules");
    // Created by 0021.
    await client.execute("ALTER TABLE categories DROP COLUMN kind");
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
    // Pre-0021 data for its backfill: the two seeded buckets that are not
    // expenses, in both locales, plus the legacy income name. OR IGNORE because
    // whichever locale this user was seeded in already owns two of these names,
    // and (name, user_id) is unique — those rows serve the assertion equally
    // well. Everything else — 'Migration Test Cat' above — must come out of the
    // backfill an expense.
    await client.execute({
      sql: `INSERT OR IGNORE INTO categories (id, user_id, name, created_at)
            VALUES ('mig-cat-salary', ?, 'Salary', ?),
                   ('mig-cat-salaris', ?, 'Salaris', ?),
                   ('mig-cat-legacy', ?, 'Income - Other', ?),
                   ('mig-cat-transfer', ?, 'Internal Transfer', ?),
                   ('mig-cat-overb', ?, 'Interne overboeking', ?)`,
      args: [
        seededUserId, nowIso,
        seededUserId, nowIso,
        seededUserId, nowIso,
        seededUserId, nowIso,
        seededUserId, nowIso,
      ],
    });
    await client.execute({
      sql: `INSERT INTO budgets (id, user_id, category_id, amount, period, is_active, status, source, created_at)
            VALUES ('mig-budget', ?, 'mig-cat', 100, 'monthly', 1, 'active', 'manual', ?)`,
      args: [seededUserId, nowIso],
    });

    // Must not error on the existing tables (no "table already exists").
    await expect(runMigrations()).resolves.not.toThrow();

    // 0021 backfill: the income and transfer buckets are labelled per locale,
    // and every other pre-existing category lands on the "expense" default.
    const kindRows = (
      await client.execute({
        sql: "SELECT name, kind FROM categories WHERE user_id = ?",
        args: [seededUserId],
      })
    ).rows as unknown as { name: string; kind: string }[];
    const kindOf = new Map(kindRows.map((r) => [r.name, r.kind]));
    expect(kindOf.get("Salary")).toBe("income");
    expect(kindOf.get("Salaris")).toBe("income");
    expect(kindOf.get("Income - Other")).toBe("income");
    expect(kindOf.get("Internal Transfer")).toBe("transfer");
    expect(kindOf.get("Interne overboeking")).toBe("transfer");
    expect(kindOf.get("Migration Test Cat")).toBe("expense");

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
    expect(await tableNames()).toContain("account_members");
    expect(await columnNames("transactions")).toContain("created_by");
    expect(await columnNames("user_preferences")).toContain("main_budget_plan_id");
  });

  it("recovers from a migration applied without a ledger row", async () => {
    // What took prod down: drizzle's libsql migrator batches every pending
    // statement without a transaction, so a batch that dies partway leaves the
    // DDL committed and the ledger row missing. Here 0021 added `kind` and then
    // the batch died — before its backfill, before its ledger row, before 0022.
    const from = journal.entries[21].when;
    await client.execute({
      sql: "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
      args: [from],
    });
    await client.execute("ALTER TABLE budget_plans DROP COLUMN share_percents"); // 0022
    await client.execute("UPDATE categories SET kind = 'expense'"); // 0021's backfill never ran

    // Previously: LibsqlError "duplicate column name: kind".
    await expect(runMigrations()).resolves.not.toThrow();

    const ledger = await client.execute("SELECT count(*) n FROM __drizzle_migrations");
    expect(Number(ledger.rows[0].n)).toBe(migrationCount);
    // 0021 replayed (its backfill is idempotent), 0022+ left to the migrator.
    const kinds = await client.execute(
      "SELECT name, kind FROM categories WHERE name IN ('Salary', 'Internal Transfer') ORDER BY name",
    );
    expect(kinds.rows.map((r) => r.kind)).toEqual(["transfer", "income"]);
    expect(await columnNames("budget_plans")).toContain("share_percents");
  });

  it("repairs a category whose kind fell outside the enum", async () => {
    // 0027. The settings list groups strictly by kind, so a row with any other
    // value is filtered out of every group — invisible, while the heading still
    // counts it. Budgets, insights and transfer detection ask by kind too.
    await client.execute("UPDATE categories SET kind = 'bogus' WHERE kind = 'expense'");
    await client.execute({
      sql: "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
      args: [journal.entries[27].when],
    });

    await runMigrations();

    const kinds = await client.execute(
      "SELECT kind, count(*) n FROM categories GROUP BY kind ORDER BY kind",
    );
    expect(kinds.rows.map((r) => r.kind)).toEqual(["expense", "income", "transfer"]);
  });

  it("recovers when an earlier migration is pending and a later column exists", async () => {
    // The state the previous recovery could not reach: 0019 genuinely never
    // ran, but `categories.kind` (0021) is already there — added out of band,
    // e.g. by initializeDatabase's drift repair, so "the batch is sequential,
    // nothing after a pending migration can have run" does not hold. Bailing at
    // 0019 handed 0021 back to the migrator and it died on "duplicate column
    // name: kind". Each statement is now skipped on its own evidence.
    await client.execute({
      sql: "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
      args: [journal.entries[19].when],
    });
    await client.execute("ALTER TABLE budget_plans DROP COLUMN owner_share_percent"); // 0019
    await client.execute("ALTER TABLE budget_plans DROP COLUMN share_percents"); // 0022
    // 0020's tables and 0021's `kind` stay: re-running those must not throw.
    await client.execute("UPDATE categories SET kind = 'expense'");

    await expect(runMigrations()).resolves.not.toThrow();

    expect(await columnNames("budget_plans")).toContain("owner_share_percent");
    expect(await columnNames("budget_plans")).toContain("share_percents");
    const kinds = await client.execute(
      "SELECT name, kind FROM categories WHERE name IN ('Salary', 'Internal Transfer') ORDER BY name",
    );
    expect(kinds.rows.map((r) => r.kind)).toEqual(["transfer", "income"]);
    const ledger = await client.execute("SELECT count(*) n FROM __drizzle_migrations");
    expect(Number(ledger.rows[0].n)).toBe(migrationCount);
  });
});
