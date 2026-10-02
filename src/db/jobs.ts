import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { adminDb } from "./index";
import {
  bankAccountLinks,
  bankConnections,
  bankCredentials,
  jobs,
  workerHeartbeat,
  type Job,
  type JobType,
} from "./schema";
import { scrubPayload } from "@/lib/jobs/types";

/**
 * The job queue's cross-user operations. A worker serves every user, so
 * claiming the next job, reclaiming abandoned ones and finding due syncs can't
 * be scoped to one user_id — that is the ONLY reason this file uses adminDb.
 * Everything a handler does after the claim goes through the tenant-guarded
 * `db`, scoped to the job's user.
 *
 * Writes that finish a job are fenced on `locked_by`: a worker whose lease ran
 * out (and whose job the reaper handed to someone else) can no longer report
 * on it.
 */

const LEASE_MS = 5 * 60_000;

const iso = (ms: number) => new Date(ms).toISOString();

/** Exponential backoff with ±20% jitter: 1 min, 5 min, 30 min, 2 h, 6 h. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600];
export function backoffMs(attempt: number, random = Math.random): number {
  const base = BACKOFF_SECONDS[Math.min(Math.max(attempt, 1), BACKOFF_SECONDS.length) - 1] * 1000;
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Atomically take the next due job. One UPDATE … WHERE id IN (SELECT … LIMIT 1)
 * statement: SQLite serialises writers, so two workers can never claim the
 * same row. `maxPriority` lets the fast loop take interactive jobs only.
 */
export async function claimNextJob(
  workerId: string,
  opts: { maxPriority?: number; now?: number } = {},
): Promise<Job | null> {
  const now = opts.now ?? Date.now();
  const due = and(
    eq(jobs.status, "queued"),
    lte(jobs.runAt, iso(now)),
    opts.maxPriority !== undefined ? lte(jobs.priority, opts.maxPriority) : undefined,
  );
  const next = adminDb
    .select({ id: jobs.id })
    .from(jobs)
    .where(due)
    .orderBy(asc(jobs.priority), asc(jobs.runAt))
    .limit(1);
  const [job] = await adminDb
    .update(jobs)
    .set({
      status: "running",
      lockedBy: workerId,
      lockedUntil: iso(now + LEASE_MS),
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: iso(now),
    })
    .where(and(inArray(jobs.id, next), eq(jobs.status, "queued")))
    .returning();
  return job ?? null;
}

/** Keep a long-running job's lease alive. False when the lease is lost. */
export async function extendLease(jobId: string, workerId: string): Promise<boolean> {
  const rows = await adminDb
    .update(jobs)
    .set({ lockedUntil: iso(Date.now() + LEASE_MS), updatedAt: iso(Date.now()) })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId), eq(jobs.status, "running")))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

function held(jobId: string, workerId: string) {
  return and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId), eq(jobs.status, "running"));
}

const released = { lockedBy: null, lockedUntil: null } as const;

export async function completeJob(jobId: string, workerId: string, result: unknown): Promise<void> {
  await adminDb
    .update(jobs)
    .set({
      ...released,
      status: "succeeded",
      payload: "{}",
      result: result === undefined ? null : JSON.stringify(result),
      lastErrorCode: null,
      lastError: null,
      finishedAt: iso(Date.now()),
      updatedAt: iso(Date.now()),
    })
    .where(held(jobId, workerId));
}

/**
 * Put the job back in the queue for a later attempt. A rate limit is the
 * bank's quota talking, not a failure of ours — it doesn't use up an attempt.
 */
export async function retryJob(
  job: Pick<Job, "id">,
  workerId: string,
  opts: { runAt: number; code: string; message: string; countsAsAttempt: boolean },
): Promise<void> {
  await adminDb
    .update(jobs)
    .set({
      ...released,
      status: "queued",
      runAt: iso(opts.runAt),
      lastErrorCode: opts.code,
      lastError: opts.message.slice(0, 500),
      ...(opts.countsAsAttempt ? {} : { attempts: sql`max(${jobs.attempts} - 1, 0)` }),
      updatedAt: iso(Date.now()),
    })
    .where(held(job.id, workerId));
}

/**
 * Finish the job without retrying. "failed": the user has to act and the
 * outcome is on their connection or credential. "dead": the dead-letter
 * queue — kept (with its scrubbed payload) so an admin can inspect and replay.
 */
export async function finishJobWithError(
  job: Pick<Job, "id" | "type" | "payload">,
  workerId: string,
  opts: { status: "failed" | "dead"; code: string; message: string; result?: unknown },
): Promise<void> {
  await adminDb
    .update(jobs)
    .set({
      ...released,
      status: opts.status,
      payload: opts.status === "dead" ? scrubbedPayload(job) : "{}",
      result: opts.result === undefined ? null : JSON.stringify(opts.result),
      lastErrorCode: opts.code,
      lastError: opts.message.slice(0, 500),
      finishedAt: iso(Date.now()),
      updatedAt: iso(Date.now()),
    })
    .where(held(job.id, workerId));
}

function scrubbedPayload(job: Pick<Job, "type" | "payload">): string {
  try {
    return JSON.stringify(scrubPayload(job.type, JSON.parse(job.payload)));
  } catch {
    return "{}";
  }
}

/**
 * Jobs whose worker died mid-run: the lease lapsed. Back to the queue with a
 * backoff, or into the dead-letter queue once attempts are used up.
 */
export async function reapExpiredLeases(now = Date.now()): Promise<number> {
  const stale = await adminDb
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedUntil, iso(now))));
  for (const job of stale) {
    const exhausted = job.attempts >= job.maxAttempts;
    await adminDb
      .update(jobs)
      .set({
        ...released,
        status: exhausted ? "dead" : "queued",
        runAt: exhausted ? job.runAt : iso(now + backoffMs(job.attempts)),
        payload: exhausted ? scrubbedPayload(job) : job.payload,
        lastErrorCode: "lease_expired",
        lastError: "The worker stopped before finishing this job.",
        finishedAt: exhausted ? iso(now) : null,
        updatedAt: iso(now),
      })
      // Only if nobody touched it since we looked.
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedUntil, job.lockedUntil!)));
  }
  return stale.length;
}

/**
 * Queue a background sync for every link that is due: active connection,
 * verified credential, not synced within `intervalMs`. The dedupe key keeps
 * this idempotent — a link with a sync already queued or running is skipped.
 */
export async function enqueueDueSyncs(intervalMs: number, now = Date.now()): Promise<number> {
  const due = await adminDb
    .select({ id: bankAccountLinks.id, userId: bankAccountLinks.userId })
    .from(bankAccountLinks)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccountLinks.connectionId))
    .innerJoin(bankCredentials, eq(bankCredentials.id, bankConnections.credentialId))
    .where(
      and(
        eq(bankConnections.status, "active"),
        eq(bankCredentials.status, "verified"),
        or(isNull(bankAccountLinks.lastSyncedAt), lt(bankAccountLinks.lastSyncedAt, iso(now - intervalMs))),
      ),
    );
  let queued = 0;
  for (const link of due) {
    const rows = await adminDb
      .insert(jobs)
      .values({
        userId: link.userId,
        type: "bank.sync_link",
        payload: JSON.stringify({ linkId: link.id }),
        priority: 10,
        dedupeKey: `sync:${link.id}`,
        runAt: iso(now),
        createdAt: iso(now),
        updatedAt: iso(now),
      })
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    queued += rows.length;
  }
  return queued;
}

/** Connections (cross-user) whose consent ends within `withinMs` and weren't warned yet. */
export async function connectionsNearingExpiry(withinMs: number, now = Date.now()) {
  return adminDb
    .select({ id: bankConnections.id, userId: bankConnections.userId, aspspName: bankConnections.aspspName, validUntil: bankConnections.validUntil })
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.status, "active"),
        isNull(bankConnections.expiryNotifiedAt),
        lte(bankConnections.validUntil, iso(now + withinMs)),
      ),
    );
}

/** Mark connections whose consent has run out — no sync can succeed any more. */
export async function expireLapsedConnections(now = Date.now()): Promise<number> {
  const rows = await adminDb
    .update(bankConnections)
    .set({ status: "expired", lastErrorCode: "consent_expired", updatedAt: iso(now) })
    .where(and(eq(bankConnections.status, "active"), lt(bankConnections.validUntil, iso(now))))
    .returning({ id: bankConnections.id });
  return rows.length;
}

export async function markExpiryNotified(connectionId: string, userId: string): Promise<void> {
  await adminDb
    .update(bankConnections)
    .set({ expiryNotifiedAt: iso(Date.now()) })
    .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)));
}

/** Finished jobs are history, not data: succeeded/failed after 30 days, dead after 90. */
export async function cleanupFinishedJobs(now = Date.now()): Promise<void> {
  await adminDb
    .delete(jobs)
    .where(
      or(
        and(inArray(jobs.status, ["succeeded", "failed", "cancelled"]), lt(jobs.finishedAt, iso(now - 30 * 86_400_000))),
        and(eq(jobs.status, "dead"), lt(jobs.finishedAt, iso(now - 90 * 86_400_000))),
      ),
    );
}

export async function beat(workerId: string, startedAt: string): Promise<void> {
  const seenAt = iso(Date.now());
  await adminDb
    .insert(workerHeartbeat)
    .values({ workerId, startedAt, seenAt })
    .onConflictDoUpdate({ target: workerHeartbeat.workerId, set: { seenAt } });
  // Rows of workers long gone (container replaced) would otherwise pile up.
  await adminDb.delete(workerHeartbeat).where(lt(workerHeartbeat.seenAt, iso(Date.now() - 86_400_000)));
}

/** When any worker was last alive, or null if none ever ran. */
export async function lastHeartbeat(): Promise<string | null> {
  const [row] = await adminDb
    .select({ seenAt: workerHeartbeat.seenAt })
    .from(workerHeartbeat)
    .orderBy(desc(workerHeartbeat.seenAt))
    .limit(1);
  return row?.seenAt ?? null;
}

// ─── Backoffice: the dead-letter queue ──────────────────────────────────

/** Dead jobs for the backoffice: metadata only, never the payload. */
export async function listDeadJobs(limit = 100) {
  return adminDb
    .select({
      id: jobs.id,
      userId: jobs.userId,
      type: jobs.type,
      attempts: jobs.attempts,
      lastErrorCode: jobs.lastErrorCode,
      lastError: jobs.lastError,
      createdAt: jobs.createdAt,
      finishedAt: jobs.finishedAt,
    })
    .from(jobs)
    .where(eq(jobs.status, "dead"))
    .orderBy(desc(jobs.finishedAt))
    .limit(limit);
}

/** Give a dead job a fresh set of attempts. */
export async function replayDeadJob(jobId: string): Promise<Pick<Job, "id" | "userId" | "type"> | null> {
  const now = iso(Date.now());
  const [row] = await adminDb
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAt: now, finishedAt: null, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "dead")))
    .returning({ id: jobs.id, userId: jobs.userId, type: jobs.type });
  return row ?? null;
}

export async function discardDeadJob(jobId: string): Promise<Pick<Job, "id" | "userId" | "type"> | null> {
  const now = iso(Date.now());
  const [row] = await adminDb
    .update(jobs)
    .set({ status: "cancelled", payload: "{}", finishedAt: now, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "dead")))
    .returning({ id: jobs.id, userId: jobs.userId, type: jobs.type });
  return row ?? null;
}

export type { JobType };
