import { sql } from "drizzle-orm";
import { adminDb } from "./index";

/**
 * With the bank-sync worker, two processes share the SQLite file (both
 * containers mount the same volume on one host). WAL lets readers and one
 * writer proceed side by side instead of locking each other out; the busy
 * timeout (set on the client, see getClient) waits out a held lock rather than
 * failing at once. WAL is a property of the database file, so setting it once
 * from either process is enough — it is a no-op on Turso.
 */
export async function enableWal(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (url && !url.startsWith("file:")) return;
  await adminDb.run(sql`PRAGMA journal_mode = WAL`).catch(() => {});
}
