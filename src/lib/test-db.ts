/**
 * Shared test-only DB bootstrap (imported by *.test.ts files, never by app
 * code). Points the lazy `@/db` proxy at a fresh temp SQLite file and creates
 * the schema.
 *
 * The proxy in src/db/index.ts only opens its connection on first property
 * access, so as long as `setupTestDb` runs before the first query (module
 * bodies run before tests, and ES-import hoisting is harmless because imports
 * never touch the DB at load time), the proxy and the schema-setup client
 * below share the same file.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createClient, type Client } from "@libsql/client";

export interface TestDb {
  client: Client;
  /** Delete all rows from every data table (keeps schema). */
  reset(): Promise<void>;
  /** Close the client and remove the temp file. */
  cleanup(): Promise<void>;
}

const TABLES = [
  "reimbursement_links",
  "account_members",
  "split_rule_lines",
  "split_rules",
  "transactions",
  "transaction_groups",
  "budget_month_targets",
  "budget_sub_lines",
  "budgets",
  "budget_plans",
  "recurring_transactions",
  "category_rules",
  "categories",
  "user_preferences",
  "audit_log",
  "accounts",
  '"user"',
];

export async function setupTestDb(name: string): Promise<TestDb> {
  const dbPath = path.join(
    os.tmpdir(),
    `fintrack-${name}-${process.pid}-${Date.now()}.db`,
  );
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

  const client = createClient({ url: `file:${dbPath}` });

  const ddl = [
    `CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT, email TEXT, email_verified INTEGER,
      image TEXT,
      role TEXT,
      created_at INTEGER, updated_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      bank_name TEXT, bank TEXT, iban TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      initial_balance REAL NOT NULL DEFAULT 0,
      internal_transfers INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      budget_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS budget_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_main INTEGER NOT NULL DEFAULT 0,
      period TEXT NOT NULL DEFAULT 'monthly',
      period_started_at TEXT,
      owner_share_percent INTEGER NOT NULL DEFAULT 50,
      share_percents TEXT,
      split_mode TEXT NOT NULL DEFAULT 'percent',
      owner_share_amount REAL,
      share_amounts TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS budget_month_targets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      budget_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month_index INTEGER NOT NULL,
      target REAL NOT NULL,
      frozen_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_month_targets_slot
      ON budget_month_targets (budget_id, category_id, year, month_index)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_plans_user_main
      ON budget_plans (user_id) WHERE is_main = 1`,
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      icon TEXT, color TEXT,
      kind TEXT NOT NULL DEFAULT 'spending',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS category_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category_id TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'contains',
      match_field TEXT NOT NULL DEFAULT 'both',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      balance REAL,
      counterparty_iban TEXT,
      category_id TEXT,
      category_label TEXT,
      category_source TEXT,
      type TEXT NOT NULL,
      linked_transaction_id TEXT,
      transfer_dismissed INTEGER NOT NULL DEFAULT 0,
      reimburses_transaction_id TEXT,
      notes TEXT,
      created_by TEXT,
      modified_by TEXT,
      is_manual INTEGER NOT NULL DEFAULT 0,
      is_mirror INTEGER NOT NULL DEFAULT 0,
      import_batch_id TEXT,
      group_id TEXT,
      recurring_transaction_id TEXT,
      parent_transaction_id TEXT,
      is_split_parent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS split_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'contains',
      match_field TEXT NOT NULL DEFAULT 'both',
      mode TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS split_rule_lines (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      percentage REAL,
      amount REAL,
      is_remainder INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS recurring_transactions (
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
    )`,
    `CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      budget_id TEXT,
      category_id TEXT NOT NULL,
      amount REAL NOT NULL,
      period TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'manual',
      generated_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS budget_sub_lines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      allocation_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      recurring_transaction_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS reimbursement_links (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL,
      expense_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transaction_groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category_id TEXT,
      target_amount REAL,
      target_date TEXT,
      funded_amount REAL NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      auto_budget_enabled INTEGER NOT NULL DEFAULT 1,
      auto_budget_interval_months INTEGER NOT NULL DEFAULT 1,
      auto_budget_lookback_months INTEGER NOT NULL DEFAULT 3,
      last_auto_budget_check_at TEXT,
      financial_month_start_day INTEGER NOT NULL DEFAULT 1,
      default_account_id TEXT,
      hide_internal_transfers INTEGER NOT NULL DEFAULT 0,
      count_cross_budget_transfers INTEGER NOT NULL DEFAULT 0,
      locale TEXT NOT NULL DEFAULT 'en',
      simple_mode INTEGER NOT NULL DEFAULT 0,
      main_budget_plan_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS account_members (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      user_id TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT UNIQUE,
      expires_at TEXT,
      accepted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_members_account_email
      ON account_members (account_id, email) WHERE revoked_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS stat_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      target_type TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    )`,
  ];
  for (const stmt of ddl) await client.execute(stmt);

  return {
    client,
    async reset() {
      for (const t of TABLES) await client.execute(`DELETE FROM ${t}`);
    },
    async cleanup() {
      client.close();
      fs.rmSync(dbPath, { force: true });
    },
  };
}
