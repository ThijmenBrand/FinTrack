import {
  cleanupFinishedJobs,
  connectionsNearingExpiry,
  enqueueDueSyncs,
  expireLapsedConnections,
  markExpiryNotified,
  reapExpiredLeases,
} from "@/db/jobs";
import { EXPIRY_WARNING_MS, SYNC_INTERVAL_MS } from "@/lib/bank-sync/config";
import { notifyBankEvent } from "@/lib/bank-sync/notify";

/**
 * Periodic housekeeping, run by the worker. Every step is idempotent, so a
 * tick that overlaps a restart or a second worker does no harm.
 */

/** Every 15 minutes: due syncs, lapsed consents, expiry warnings. */
export async function schedulerTick(now = Date.now()): Promise<{ queued: number; expired: number; warned: number }> {
  const expired = await expireLapsedConnections(now);
  const queued = await enqueueDueSyncs(SYNC_INTERVAL_MS, now);

  let warned = 0;
  for (const c of await connectionsNearingExpiry(EXPIRY_WARNING_MS, now)) {
    // Marked first: a mail that fails is not worth a daily retry storm, and
    // the UI shows the warning regardless.
    await markExpiryNotified(c.id, c.userId);
    await notifyBankEvent(c.userId, "consentExpiring", {
      bank: c.aspspName,
      date: c.validUntil ? c.validUntil.slice(0, 10) : "",
    });
    warned++;
  }
  return { queued, expired, warned };
}

/** Every minute: jobs whose worker died mid-run go back to the queue (or the DLQ). */
export async function reaperTick(now = Date.now()): Promise<number> {
  return reapExpiredLeases(now);
}

/** Daily: finished jobs are history, not data. */
export async function cleanupTick(now = Date.now()): Promise<void> {
  await cleanupFinishedJobs(now);
}
