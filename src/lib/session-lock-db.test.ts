import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("session-lock");

const {
  LOCK_AFTER_MS,
  MAX_UNLOCK_FAILURES,
  readLockState,
  recordUnlockFailure,
  touchSession,
  unlockMethods,
  unlockSession,
} = await import("@/lib/session-lock");

const USER = "user-1";
const SESSION = "session-1";
const NOW = Date.parse("2026-10-06T12:00:00Z");

/** The real migration, so the table under test is the one that ships. */
function lockMigration(): string[] {
  const dir = path.join(process.cwd(), "drizzle");
  const file = fs.readdirSync(dir).find((f) => /^\d+_session_lock\.sql$/.test(f));
  if (!file) throw new Error("session_lock migration not found");
  return fs
    .readFileSync(path.join(dir, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function exec(sql: string, args: (string | number)[] = []) {
  await testDb.client.execute({ sql, args });
}

async function addSession(id: string, createdAt: number, updatedAt = createdAt) {
  await exec(
    "INSERT INTO session (id, token, user_id, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, `token-${id}`, USER, createdAt, updatedAt, NOW + LOCK_AFTER_MS * 24],
  );
}

async function sessionExists(id: string): Promise<boolean> {
  const r = await testDb.client.execute({ sql: "SELECT 1 FROM session WHERE id = ?", args: [id] });
  return r.rows.length > 0;
}

beforeAll(async () => {
  // better-auth's tables aren't part of the shared test schema; only the
  // columns this module reads.
  await exec(`CREATE TABLE session (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`);
  await exec(`CREATE TABLE account (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, password TEXT
  )`);
  await exec(`CREATE TABLE passkey (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`);
});

beforeEach(async () => {
  await testDb.reset();
  // Each test runs the migration itself — some need sessions in place first.
  await exec("DROP TABLE IF EXISTS session_activity");
  for (const t of ["session", "account", "passkey"]) await exec(`DELETE FROM ${t}`);
  await exec(`INSERT INTO "user" (id, name, email, role) VALUES (?, 'Alice', 'a@example.com', 'user')`, [USER]);
});
afterAll(() => testDb.cleanup());

async function migrate() {
  for (const stmt of lockMigration()) await exec(stmt);
}

describe("session lock storage", () => {
  it("backfills sessions that predate the lock from their last update", async () => {
    await addSession("recent", NOW - LOCK_AFTER_MS * 5, NOW - 10 * 60_000);
    await addSession("idle", NOW - LOCK_AFTER_MS * 5, NOW - LOCK_AFTER_MS * 2);
    await migrate();

    expect((await readLockState("recent", NOW)).locked).toBe(false);
    expect((await readLockState("idle", NOW)).locked).toBe(true);
  });

  it("locks an hour after the last recorded activity, and unlocks again", async () => {
    await migrate();
    await addSession(SESSION, NOW - LOCK_AFTER_MS * 3);
    await touchSession(SESSION, USER, NOW - LOCK_AFTER_MS + 1_000);
    expect((await readLockState(SESSION, NOW)).locked).toBe(false);
    expect((await readLockState(SESSION, NOW + 1_000)).locked).toBe(true);

    await unlockSession(SESSION, USER, NOW + 1_000);
    expect((await readLockState(SESSION, NOW + 2_000)).locked).toBe(false);
  });

  it("treats a session that no longer exists as locked", async () => {
    await migrate();
    expect((await readLockState("gone", NOW)).locked).toBe(true);
  });

  it("signs the session out after too many wrong passwords", async () => {
    await migrate();
    await addSession(SESSION, NOW - LOCK_AFTER_MS * 3);

    const left: number[] = [];
    for (let i = 0; i < MAX_UNLOCK_FAILURES; i++) {
      left.push(await recordUnlockFailure(SESSION, USER));
    }

    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await sessionExists(SESSION)).toBe(false);
  });

  it("a wrong password never unlocks a session that had no activity row", async () => {
    await migrate();
    await addSession(SESSION, NOW - LOCK_AFTER_MS * 3);
    await recordUnlockFailure(SESSION, USER);
    expect((await readLockState(SESSION, NOW)).locked).toBe(true);
  });

  it("starts the count again after a successful unlock", async () => {
    await migrate();
    await addSession(SESSION, NOW - LOCK_AFTER_MS * 3);
    for (let i = 0; i < MAX_UNLOCK_FAILURES - 1; i++) await recordUnlockFailure(SESSION, USER);

    await unlockSession(SESSION, USER, NOW);

    expect(await recordUnlockFailure(SESSION, USER)).toBe(MAX_UNLOCK_FAILURES - 1);
    expect(await sessionExists(SESSION)).toBe(true);
  });

  it("offers the password only to non-admins who have one", async () => {
    await migrate();
    expect(await unlockMethods(USER)).toEqual({ passkey: false, password: false });

    await exec("INSERT INTO account (id, user_id, provider_id, password) VALUES ('a1', ?, 'credential', 'x')", [USER]);
    await exec("INSERT INTO passkey (id, user_id) VALUES ('p1', ?)", [USER]);
    expect(await unlockMethods(USER)).toEqual({ passkey: true, password: true });

    await exec(`UPDATE "user" SET role = 'admin' WHERE id = ?`, [USER]);
    expect(await unlockMethods(USER)).toEqual({ passkey: true, password: false });
  });
});
