import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { jobs, type Job } from "@/db/schema";
import { JOB_PRIORITY, type JobPayloads } from "./types";

type JobKind = keyof JobPayloads;

interface EnqueueOptions {
  priority?: number;
  /** One queued-or-running job per key; a second enqueue returns the first. */
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  /** Enqueue inside the caller's transaction (atomic with its other writes). */
  tx?: DbTx;
}

/**
 * Queue a job for the worker on behalf of `userId`. The web app's only write
 * into the queue — it can ask for work, never run it. Returns the job id (the
 * already-active one when the dedupe key is taken).
 */
export async function enqueueJob<K extends JobKind>(
  userId: string,
  type: K,
  payload: JobPayloads[K],
  opts: EnqueueOptions = {},
): Promise<string> {
  const writer = opts.tx ?? db;
  const now = new Date().toISOString();
  const [row] = await writer
    .insert(jobs)
    .values({
      userId,
      type,
      payload: JSON.stringify(payload),
      priority: opts.priority ?? JOB_PRIORITY.background,
      dedupeKey: opts.dedupeKey ?? null,
      runAt: (opts.runAt ?? new Date()).toISOString(),
      maxAttempts: opts.maxAttempts ?? 5,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  if (row) return row.id;

  const [active] = await writer
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.dedupeKey, opts.dedupeKey!),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (!active) throw new Error("Job dedupe conflict without an active job");
  return active.id;
}

export interface JobView {
  id: string;
  type: Job["type"];
  status: Job["status"];
  result: unknown;
  errorCode: string | null;
}

/** A job of `userId`'s, as the polling UI sees it — or null if it isn't theirs. */
export async function getJobForUser(userId: string, jobId: string): Promise<JobView | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      result: jobs.result,
      errorCode: jobs.lastErrorCode,
    })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (!row) return null;
  let result: unknown = null;
  if (row.result) {
    try {
      result = JSON.parse(row.result);
    } catch {
      result = null;
    }
  }
  return { ...row, result };
}
