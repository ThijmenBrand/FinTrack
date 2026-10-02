import {
  backoffMs,
  claimNextJob,
  completeJob,
  extendLease,
  finishJobWithError,
  retryJob,
} from "@/db/jobs";
import type { Job } from "@/db/schema";
import type { JobPayloads } from "@/lib/jobs/types";
import { JobError, bug, classifyUnknown } from "./errors";
import { generateCredentialHandler, verifyCredentialHandler, deleteCredentialHandler } from "./handlers/credentials";
import {
  completeAuthHandler,
  listAspspsHandler,
  revokeSessionHandler,
  startAuthHandler,
} from "./handlers/connect";
import { syncLinkHandler } from "./handlers/sync";
import type { Handler, JobContext } from "./handlers/types";

type Handlers = { [K in keyof JobPayloads]: Handler<K> };

export const handlers: Handlers = {
  "bank.generate_credential": generateCredentialHandler,
  "bank.verify_credential": verifyCredentialHandler,
  "bank.list_aspsps": listAspspsHandler,
  "bank.start_auth": startAuthHandler,
  "bank.complete_auth": completeAuthHandler,
  "bank.sync_link": syncLinkHandler,
  "bank.revoke_session": revokeSessionHandler,
  "bank.delete_credential": deleteCredentialHandler,
};

export interface RunnerHooks {
  /** A job went to the dead-letter queue: alert (no payload, no user data). */
  onDead?: (job: Pick<Job, "id" | "type">, err: JobError) => void;
}

/** Renew the lease every minute while a handler runs (the lease is five). */
const KEEPALIVE_MS = 60_000;

/**
 * Claim one due job and run it to an outcome. Returns false when the queue had
 * nothing due (so the loop can sleep).
 */
export async function runOnce(
  workerId: string,
  opts: { maxPriority?: number; hooks?: RunnerHooks; handlers?: Partial<Handlers> } = {},
): Promise<boolean> {
  const job = await claimNextJob(workerId, { maxPriority: opts.maxPriority });
  if (!job) return false;
  await runJob(job, workerId, opts);
  return true;
}

export async function runJob(
  job: Job,
  workerId: string,
  opts: { hooks?: RunnerHooks; handlers?: Partial<Handlers> } = {},
): Promise<void> {
  const table = { ...handlers, ...opts.handlers } as Handlers;
  let lost = false;
  const keepAlive = async () => {
    if (!(await extendLease(job.id, workerId))) lost = true;
  };
  const timer = setInterval(() => void keepAlive(), KEEPALIVE_MS);
  timer.unref?.();

  try {
    let payload: unknown;
    try {
      payload = JSON.parse(job.payload);
    } catch {
      throw bug("invalid_payload", "Job payload is not JSON");
    }
    const handler = table[job.type] as Handler<keyof JobPayloads> | undefined;
    if (!handler) throw bug("invalid_payload", "Unknown job type");
    const ctx: JobContext = {
      jobId: job.id,
      userId: job.userId,
      attempts: job.attempts,
      keepAlive,
    };
    const result = await handler(payload as never, ctx);
    if (!lost) await completeJob(job.id, workerId, result ?? null);
  } catch (raw) {
    const err = classifyUnknown(raw);
    await settleFailure(job, workerId, err, opts.hooks);
  } finally {
    clearInterval(timer);
  }
}

async function settleFailure(job: Job, workerId: string, err: JobError, hooks?: RunnerHooks) {
  const failed = { ok: false, code: err.code };
  switch (err.kind) {
    case "rate_limited":
      await retryJob(job, workerId, {
        runAt: err.retryAt ?? Date.now() + 6 * 3_600_000,
        code: err.code,
        message: err.message,
        countsAsAttempt: false,
      });
      return;
    case "retry":
      if (job.attempts < job.maxAttempts) {
        await retryJob(job, workerId, {
          runAt: Date.now() + backoffMs(job.attempts),
          code: err.code,
          message: err.message,
          countsAsAttempt: true,
        });
        return;
      }
      await finishJobWithError(job, workerId, { status: "dead", code: err.code, message: err.message, result: failed });
      hooks?.onDead?.(job, err);
      return;
    case "user_action":
      await finishJobWithError(job, workerId, { status: "failed", code: err.code, message: err.message, result: failed });
      return;
    case "bug":
      await finishJobWithError(job, workerId, { status: "dead", code: err.code, message: err.message, result: failed });
      hooks?.onDead?.(job, err);
      return;
  }
}
