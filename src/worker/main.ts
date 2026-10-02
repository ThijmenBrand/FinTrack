/**
 * The bank-sync worker: a separate process (its own container in production)
 * and the only one that holds the bank-sync master key. It claims jobs from the
 * database queue, talks to Enable Banking, and writes results back. It opens
 * no port; the web app reaches it only through the jobs table.
 *
 *   dev:  pnpm worker:dev   (BANK_SYNC_KEK_FILE pointing at a local key file)
 *   prod: node dist/worker.mjs  (same image as the web app, second container)
 *   rotate the master key: node dist/worker.mjs rotate-kek  (see rotate-kek.ts)
 */
import fs from "node:fs";
import os from "node:os";
import { randomBytes } from "node:crypto";
import * as Sentry from "@sentry/node";
import { beat } from "@/db/jobs";
import { enableWal } from "@/db/pragmas";
import { loadKeyRing } from "./crypto/kek";
import { runOnce } from "./runner";
import { cleanupTick, reaperTick, schedulerTick } from "./scheduler";
import { scrubEvent } from "@/lib/bank-sync/scrub";

const INTERACTIVE_POLL_MS = 1_000;
const BACKGROUND_POLL_MS = 15_000;
const HEARTBEAT_MS = 30_000;
const REAPER_MS = 60_000;
const SCHEDULER_MS = 15 * 60_000;
const CLEANUP_MS = 24 * 3_600_000;
const SHUTDOWN_GRACE_MS = 25_000;
/** Touched with every heartbeat; the container healthcheck reads its age. */
const ALIVE_FILE = process.env.BANK_SYNC_ALIVE_FILE || "/tmp/worker-alive";

const workerId = `${os.hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`;
const startedAt = new Date().toISOString();
let stopping = false;
const inFlight = new Set<Promise<unknown>>();

function log(message: string) {
  console.log(`[worker ${workerId}] ${message}`);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

function track<T>(p: Promise<T>): Promise<T> {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
  return p;
}

const hooks = {
  onDead: (job: { id: string; type: string }, err: { code: string }) => {
    // Ids and codes only: no payload, no user data.
    Sentry.captureMessage(`Job dead-lettered: ${job.type} (${err.code})`, {
      level: "error",
      tags: { jobType: job.type, errorCode: err.code },
      extra: { jobId: job.id },
    });
  },
};

/** Drain due jobs at most `maxPriority`, then sleep `pollMs`; until shutdown. */
async function loop(name: string, pollMs: number, maxPriority?: number) {
  while (!stopping) {
    try {
      const worked = await track(runOnce(workerId, { maxPriority, hooks }));
      if (worked) continue;
    } catch (err) {
      // The queue itself failed (database down?). Back off, keep going.
      Sentry.captureException(err);
      log(`${name} loop error: ${err instanceof Error ? err.name : "error"}`);
    }
    await sleep(pollMs);
  }
}

function every(name: string, ms: number, fn: () => Promise<unknown>) {
  const run = async () => {
    if (stopping) return;
    try {
      await track(fn());
    } catch (err) {
      Sentry.captureException(err);
      log(`${name} failed: ${err instanceof Error ? err.name : "error"}`);
    }
  };
  void run();
  const timer = setInterval(run, ms);
  return timer;
}

async function main() {
  // Refuse to run without the master key: better a loud crash-loop in
  // `docker ps` than jobs that fail one by one.
  loadKeyRing();

  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: scrubEvent,
      beforeBreadcrumb: (b) => (b.category === "http" || b.category === "fetch" ? null : b),
    });
  }

  await enableWal();
  log("started");

  const timers = [
    every("heartbeat", HEARTBEAT_MS, async () => {
      await beat(workerId, startedAt);
      fs.writeFileSync(ALIVE_FILE, new Date().toISOString());
    }),
    every("reaper", REAPER_MS, () => reaperTick()),
    every("scheduler", SCHEDULER_MS, () => schedulerTick()),
    every("cleanup", CLEANUP_MS, () => cleanupTick()),
  ];

  const loops = [
    loop("interactive", INTERACTIVE_POLL_MS, 0),
    loop("background", BACKGROUND_POLL_MS),
  ];

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: finishing in-flight work`);
    timers.forEach(clearInterval);
    // Whatever doesn't finish in time keeps its lease until it lapses; the
    // reaper of the next worker hands it back to the queue.
    await Promise.race([Promise.allSettled([...inFlight]), sleep(SHUTDOWN_GRACE_MS)]);
    await Sentry.flush(2_000).catch(() => {});
    log("stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await Promise.all(loops);
}

async function rotate() {
  const { rotateKek } = await import("./rotate-kek");
  const result = await rotateKek(loadKeyRing());
  console.log(`[worker] re-sealed ${result.resealed} secret(s), ${result.failed} failed`);
  process.exit(result.failed > 0 ? 1 : 0);
}

(process.argv[2] === "rotate-kek" ? rotate() : main()).catch((err) => {
  console.error("[worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
