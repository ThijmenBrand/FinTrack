import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";

/**
 * Wait this long after a sync before evaluating, so a user with three linked
 * accounts (three sync jobs a few seconds apart) gets one evaluation over all
 * of them instead of three over partial data.
 */
export const EVALUATE_DELAY_MS = 2 * 60_000;

/** The one dedupe key per user: at most one evaluation queued or running. */
export const evaluateDedupeKey = (userId: string) => `notify-eval:${userId}`;

/**
 * Ask the worker to look at this user's data for notifications. Never throws:
 * a sync that imported rows must not fail because of a notification.
 */
export async function queueNotificationEvaluation(userId: string, reason: "sync" | "daily"): Promise<void> {
  try {
    await enqueueJob(
      userId,
      "notifications.evaluate",
      { reason },
      {
        priority: JOB_PRIORITY.background,
        dedupeKey: evaluateDedupeKey(userId),
        runAt: new Date(Date.now() + EVALUATE_DELAY_MS),
        maxAttempts: 2,
      },
    );
  } catch (err) {
    console.error("[notifications] could not queue an evaluation:", err instanceof Error ? err.name : "error");
  }
}
