import {
  cleanupFinishedJobs,
  cleanupOldNotifications,
  connectionsNearingExpiry,
  enqueueDailyNotificationEvaluations,
  enqueueDueSyncs,
  expireLapsedConnections,
  markExpiryNotified,
  reapExpiredLeases,
} from "@/db/jobs";
import { EXPIRY_WARNING_MS, SYNC_INTERVAL_MS } from "@/lib/bank-sync/config";
import { notify } from "@/lib/notifications/dispatch";

/**
 * Periodic housekeeping, run by the worker. Every step is idempotent, so a
 * tick that overlaps a restart or a second worker does no harm.
 */

/** Every 15 minutes: due syncs, lapsed consents, expiry warnings, the morning notification run. */
export async function schedulerTick(
  now = Date.now(),
): Promise<{ queued: number; expired: number; warned: number; evaluations: number }> {
  const expired = await expireLapsedConnections(now);
  const queued = await enqueueDueSyncs(SYNC_INTERVAL_MS, now);

  let warned = 0;
  for (const c of await connectionsNearingExpiry(EXPIRY_WARNING_MS, now)) {
    // Marked first: a mail that fails is not worth a daily retry storm, and
    // the UI shows the warning regardless.
    await markExpiryNotified(c.id, c.userId);
    const date = c.validUntil ? c.validUntil.slice(0, 10) : "";
    await notify(
      c.userId,
      "bank.consent_expiring",
      { connectionId: c.id, bank: c.aspspName, date },
      `bank.consent_expiring:${c.id}:${date}`,
    );
    warned++;
  }
  const evaluations = await enqueueDailyNotificationEvaluations(now);
  return { queued, expired, warned, evaluations };
}

/** Every minute: jobs whose worker died mid-run go back to the queue (or the DLQ). */
export async function reaperTick(now = Date.now()): Promise<number> {
  return reapExpiredLeases(now);
}

/** Daily: finished jobs are history, not data; old notification records likewise. */
export async function cleanupTick(now = Date.now()): Promise<void> {
  await cleanupFinishedJobs(now);
  await cleanupOldNotifications(now);
}
