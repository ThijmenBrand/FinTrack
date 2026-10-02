import type { JobPayloads } from "@/lib/jobs/types";
import { bug } from "../errors";

export interface JobContext {
  jobId: string;
  /** The user the job runs for. Every query in a handler is scoped to it. */
  userId: string;
  attempts: number;
  /** Renew the lease during long work (a big first sync). */
  keepAlive(): Promise<void>;
}

export type Handler<K extends keyof JobPayloads> = (
  payload: JobPayloads[K],
  ctx: JobContext,
) => Promise<unknown>;

/** Payloads come out of the database — check them like any other input. */
export function payloadString(payload: unknown, key: string, max = 200): string {
  const v = (payload as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string" || v.length === 0 || v.length > max) {
    throw bug("invalid_payload", `Job payload field ${key} is missing or malformed`);
  }
  return v;
}

export function optionalPayloadString(payload: unknown, key: string, max = 200): string | undefined {
  const v = (payload as Record<string, unknown> | null)?.[key];
  if (v === undefined || v === null) return undefined;
  return payloadString(payload, key, max);
}
