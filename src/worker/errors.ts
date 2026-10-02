import type { JobErrorCode } from "@/lib/jobs/types";

/**
 * How a failed job is treated. The classification matters more than the retry
 * loop around it:
 *
 *  retry        transient (network, 5xx, timeout, busy db) — back off, retry,
 *               dead-letter once attempts run out
 *  rate_limited the bank's quota — reschedule to `retryAt`, don't count the
 *               attempt, never retry fast (that would burn the next window)
 *  user_action  only the user can fix it (consent expired, key rejected) —
 *               no retry, NOT the dead-letter queue; the connection or
 *               credential carries the code and the UI asks the user to act
 *  bug          we did something wrong — straight to the dead-letter queue
 */
export type JobErrorKind = "retry" | "rate_limited" | "user_action" | "bug";

export class JobError extends Error {
  constructor(
    public readonly kind: JobErrorKind,
    public readonly code: JobErrorCode,
    message: string,
    /** For rate_limited: when the next attempt may run (epoch ms). */
    public readonly retryAt?: number,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export const retry = (code: JobErrorCode, message: string) => new JobError("retry", code, message);
export const userAction = (code: JobErrorCode, message: string) =>
  new JobError("user_action", code, message);
export const bug = (code: JobErrorCode, message: string) => new JobError("bug", code, message);

/** Anything thrown that isn't a JobError, mapped to a class. */
export function classifyUnknown(err: unknown): JobError {
  if (err instanceof JobError) return err;
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/SQLITE_BUSY|database is locked/i.test(text)) return retry("db_busy", "Database busy");
  // A message from an unknown error may carry anything — keep only its type.
  const label = err instanceof Error ? err.name : "Unknown error";
  return bug("internal", `Unexpected ${label}`);
}
