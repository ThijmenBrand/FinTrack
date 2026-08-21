import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import path from "path";
import { initializeDatabase } from "./migrate";

const MIGRATIONS_FOLDER = "drizzle";

function makeClient(): Client {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  return createClient(
    tursoUrl
      ? { url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN }
      : { url: `file:${path.join(process.cwd(), "data", "finance.db")}` },
  );
}

/**
 * Baseline a database that predates versioned migrations: it already has the
 * app tables but no drizzle ledger. Running 0000's CREATE TABLEs on it would
 * error ("table already exists"), so we stamp 0000 as applied instead. The
 * ledger row uses drizzle's own hash/folderMillis so the migrator's
 * "created_at < when" check treats 0000 as done and only runs 0001+.
 * Column-level drift from that baseline is repaired by initializeDatabase().
 */
export async function baselineIfPreMigration(client: Client) {
  const hasLedger = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  );
  const hasApp = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='user'`,
  );
  if (hasLedger.rows.length > 0 || hasApp.rows.length === 0) return;

  console.log("Existing pre-migration database detected — baselining 0000.");
  const [first] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  await client.execute(
    `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )`,
  );
  await client.execute({
    sql: `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`,
    args: [first.hash, first.folderMillis],
  });
}

const ADD_COLUMN = /^\s*ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+(?:COLUMN\s+)?`?(\w+)`?/i;

async function hasColumn(client: Client, table: string, column: string) {
  const info = await client.execute({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  });
  return info.rows.length > 0;
}

/**
 * Recover a migration that ran but never got recorded. drizzle's libsql migrator
 * sends every pending statement as ONE non-transactional batch (`stream.batch(false)`),
 * so a batch that dies partway — Turso stream timeout, or two Vercel builds
 * racing the same DB — leaves the earlier DDL committed with no ledger row, and
 * every later deploy re-runs its `ALTER TABLE … ADD <col>` and hard-fails with
 * "duplicate column name". When every column a pending migration adds is already
 * there, replay its remaining statements (backfills, all idempotent) and stamp
 * it, so the migrator sees it as done.
 */
export async function stampPartiallyAppliedMigrations(client: Client) {
  const ledger = await client
    .execute(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`)
    .catch(() => null);
  const lastApplied = Number(ledger?.rows[0]?.created_at ?? 0);
  if (!lastApplied) return;

  for (const [i, migration] of readMigrationFiles({
    migrationsFolder: MIGRATIONS_FOLDER,
  }).entries()) {
    if (migration.folderMillis <= lastApplied) continue;
    const added = migration.sql
      .map((stmt) => ADD_COLUMN.exec(stmt))
      .filter((m) => m !== null) as RegExpExecArray[];
    if (added.length === 0) continue; // data-only: no evidence either way, let the migrator run it
    for (const [, table, column] of added) {
      // Genuinely pending. The batch is sequential, so nothing after it can have
      // run either — hand the rest back to the migrator.
      if (!(await hasColumn(client, table, column))) return;
    }
    console.log(`Migration #${i} already applied but unrecorded — replaying backfills, stamping.`);
    for (const stmt of migration.sql) {
      if (stmt.trim() && !ADD_COLUMN.test(stmt)) await client.execute(stmt);
    }
    await client.execute({
      sql: `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`,
      args: [migration.hash, migration.folderMillis],
    });
  }
}

/**
 * Bring the database (Turso in prod, local SQLite file otherwise) fully up to
 * date: baseline a pre-migration DB, apply pending versioned migrations, then
 * seed and repair column-level drift. Targets whatever TURSO_DATABASE_URL /
 * `@/db` point at, so tests can redirect it at a temp file.
 */
export async function runMigrations() {
  const client = makeClient();
  const db = drizzle(client);

  await baselineIfPreMigration(client);
  await stampPartiallyAppliedMigrations(client);

  // Fresh DB: applies 0000 (creates everything). Existing DB: 0000 is stamped,
  // so only newer migrations run.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Seed admin/categories, repair column-level drift, one-shot data backfills.
  await initializeDatabase();

  client.close();
}
