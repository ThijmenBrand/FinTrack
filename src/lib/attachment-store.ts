import { del } from "@vercel/blob";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactionAttachments, transactions } from "@/db/schema";
import { isAttachmentPathname } from "@/lib/attachments";

/** An unclaimed row older than this is an import nobody came back to finish. */
const UNCLAIMED_TTL_MS = 24 * 60 * 60 * 1000;

/** Most blobs one call will remove — a bound on a best-effort sweep. */
const SWEEP_LIMIT = 50;

/**
 * Drop one blob. Never fatal — an orphan in the store beats a failed request.
 */
export async function discardBlob(pathname: string): Promise<void> {
  if (!isAttachmentPathname(pathname)) return;
  try {
    await del(pathname);
  } catch {
    // The row is what the app reads; a leftover object is invisible.
  }
}

/**
 * Remove this user's attachments that nothing points at any more, bytes and all.
 *
 * Two kinds of garbage, one sweep:
 *
 * - **Orphaned** — its transaction is gone. Deleted at once, and this is the
 *   only thing that deletes it: a transaction can disappear through the bulk
 *   delete, through a split being re-cut or undone, or through its account
 *   going away, and the `ON DELETE cascade` the migration declares can't be
 *   relied on (hosted libsql doesn't guarantee `foreign_keys=ON`) nor would it
 *   touch the blob. One sweep at the moments garbage appears beats a guard in
 *   every delete path.
 * - **Unclaimed and stale** — uploaded during a CSV review that was never
 *   committed. Kept for a day, because an import still open in a tab is going
 *   to claim it.
 *
 * ponytail: bounded and best-effort, so a big cleanup takes a few calls to
 * finish; the callers are the delete and upload paths, which is where garbage
 * is actually created. Move to a scheduled job if the store ever grows enough
 * to notice.
 */
export async function collectOrphanAttachments(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - UNCLAIMED_TTL_MS).toISOString();
  const stale = await db
    .select({
      id: transactionAttachments.id,
      pathname: transactionAttachments.pathname,
    })
    .from(transactionAttachments)
    .where(
      and(
        eq(transactionAttachments.userId, userId),
        or(
          and(
            isNull(transactionAttachments.transactionId),
            lt(transactionAttachments.createdAt, cutoff),
          ),
          sql`${transactionAttachments.transactionId} IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM ${transactions}
            WHERE ${transactions.id} = ${transactionAttachments.transactionId}
          )`,
        ),
      ),
    )
    .limit(SWEEP_LIMIT);

  if (!stale.length) return 0;

  // The blob deletes are independent network calls and this runs inline on an
  // upload or a bulk delete, so serialising 50 of them would be 50 round trips
  // added to a user-visible request. One batched DB delete for the same reason.
  await Promise.all(stale.map((row) => discardBlob(row.pathname)));
  await db
    .delete(transactionAttachments)
    .where(
      and(
        inArray(transactionAttachments.id, stale.map((row) => row.id)),
        eq(transactionAttachments.userId, userId),
      ),
    );
  return stale.length;
}
