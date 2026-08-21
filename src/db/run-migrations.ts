import { createClient, type Client } from "@libsql/client";
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
 * DDL that is already done. SQLite has no `ADD COLUMN IF NOT EXISTS`, so
 * "already there" can only be observed as an error.
 */
const ALREADY_APPLIED = /duplicate column name|already exists/i;

/**
 * Apply pending migrations ourselves instead of drizzle's libsql migrator.
 *
 * Two reasons. First, that migrator sends every pending statement as ONE
 * non-transactional batch and only then has the ledger rows land, so a batch
 * that dies partway — Turso stream timeout, two Vercel builds racing the same
 * DB — leaves DDL committed with no ledger row, and every later deploy re-runs
 * its `ALTER TABLE … ADD <col>` and hard-fails with "duplicate column name".
 * Here each migration is stamped as soon as its own statements are through, so
 * a dying run leaves an accurate watermark.
 *
 * Second, individual statements that were already applied are skipped rather
 * than fatal, which is what makes the run self-healing: a half-applied
 * migration, a pre-migration database that predates the ledger entirely, or a
 * column added out of band by initializeDatabase's drift repair all replay
 * cleanly. Only the idempotency errors above are swallowed; anything else
 * still fails the deploy. Column-level drift is repaired by initializeDatabase.
 */
export async function applyPendingMigrations(client: Client) {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )`,
  );
  const ledger = await client.execute(
    `SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`,
  );
  const lastApplied = Number(ledger.rows[0]?.created_at ?? 0);

  for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })) {
    if (migration.folderMillis <= lastApplied) continue;
    for (const stmt of migration.sql) {
      if (!stmt.trim()) continue;
      await client.execute(stmt).catch((e: unknown) => {
        if (!ALREADY_APPLIED.test(String(e))) throw e;
        console.log(`Skipping already-applied statement: ${stmt.slice(0, 60)}…`);
      });
    }
    await client.execute({
      sql: `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`,
      args: [migration.hash, migration.folderMillis],
    });
  }
}

/**
 * Bring the database (Turso in prod, local SQLite file otherwise) fully up to
 * date: apply pending versioned migrations, then seed and repair column-level
 * drift. Targets whatever TURSO_DATABASE_URL / `@/db` point at, so tests can
 * redirect it at a temp file.
 */
export async function runMigrations() {
  const client = makeClient();

  await applyPendingMigrations(client);

  // Seed admin/categories, repair column-level drift, one-shot data backfills.
  await initializeDatabase();

  client.close();
}
