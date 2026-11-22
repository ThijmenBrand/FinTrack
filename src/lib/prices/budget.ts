/**
 * The daily call budget for the price provider.
 *
 * EODHD's free plan allows 20 API calls a day, reset at 00:00 GMT. That is a
 * hard ceiling on a shared account — every user of this instance draws from
 * the same pot — so a call is *reserved before it is made* rather than counted
 * after. A counter that trails the requests would let a burst spend calls the
 * plan does not have, and the provider answers an over-budget request with an
 * error, not a price.
 *
 * The counter is global, which is why this file is the rare place that reaches
 * for `adminDb`: the budget belongs to the deployment's API token, not to any
 * one user, and scoping it per user would let two users spend 20 calls each.
 *
 * Reservations are atomic. `spend` increments and reads back in one statement,
 * then refunds if the new total overshot — two workers racing therefore cannot
 * both believe they took the last call.
 */
import { adminDb } from "@/db";
import { appSettings } from "@/db/schema";
import { and, like, lt, sql } from "drizzle-orm";

/** Keys look like `eodhd.calls.2026-11-22`; the date is the provider's, UTC. */
const PREFIX = "eodhd.calls.";

/** Who is asking. Background work stops short of the cap; a person does not. */
export type Caller = "interactive" | "background";

export interface Budget {
  /** Calls the plan allows per UTC day. */
  cap: number;
  /** Of those, how many only a person at the keyboard may spend. */
  reserve: number;
}

/**
 * Defaults match the free plan, with four calls held back.
 *
 * The reserve exists because the two kinds of call compete badly: the daily
 * refresh runs unattended and would happily take all 20, and the user would
 * then add a holding, hit "look up this ISIN", and be told to come back
 * tomorrow. Background work gets `cap - reserve`; a person gets the lot.
 */
export function budgetFrom(env: NodeJS.ProcessEnv = process.env): Budget {
  const cap = positiveInt(env.EODHD_DAILY_CALL_CAP, 20);
  // A reserve at or above the cap would starve the refresh entirely.
  const reserve = Math.min(positiveInt(env.EODHD_INTERACTIVE_RESERVE, 4), cap - 1);
  return { cap, reserve: Math.max(reserve, 0) };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The provider's day, not the app's: the free plan resets at 00:00 GMT. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** What a caller of this kind is allowed to reach today. */
function ceilingFor(caller: Caller, budget: Budget): number {
  return caller === "interactive" ? budget.cap : budget.cap - budget.reserve;
}

export interface SpendResult {
  ok: boolean;
  /** Calls taken today after this attempt settled, for logging and the UI. */
  used: number;
  /** What this caller may still take today. Zero once it is out. */
  remaining: number;
}

/**
 * Reserve `calls` against today's budget.
 *
 * Returns `ok: false` without reserving anything when the request would cross
 * this caller's ceiling — partial reservations are deliberately not offered.
 * A refresh that could price three of five holdings would leave the portfolio
 * internally inconsistent, two funds valued today and three valued last week,
 * and the caller is better placed to decide what to drop.
 */
export async function spend(
  calls: number,
  caller: Caller,
  opts: { now?: Date; budget?: Budget } = {},
): Promise<SpendResult> {
  const now = opts.now ?? new Date();
  const budget = opts.budget ?? budgetFrom();
  const ceiling = ceilingFor(caller, budget);
  const key = PREFIX + utcDay(now);

  if (calls <= 0) {
    const used = await callsUsed(now);
    return { ok: true, used, remaining: Math.max(0, ceiling - used) };
  }

  // Increment first, judge second. The returning value is this statement's own
  // result, so concurrent reservations get different totals and only the one
  // that actually crossed the line is refused.
  const [row] = await adminDb
    .insert(appSettings)
    .values({ key, value: String(calls), updatedAt: now.toISOString() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: sql`CAST(${appSettings.value} AS INTEGER) + ${calls}`,
        updatedAt: now.toISOString(),
      },
    })
    .returning({ value: appSettings.value });

  const used = Number(row?.value ?? calls);
  if (used <= ceiling) {
    return { ok: true, used, remaining: Math.max(0, ceiling - used) };
  }

  // Overshot: hand the calls back so a smaller request behind us still fits.
  const [refunded] = await adminDb
    .update(appSettings)
    .set({
      value: sql`MAX(CAST(${appSettings.value} AS INTEGER) - ${calls}, 0)`,
      updatedAt: now.toISOString(),
    })
    .where(sql`${appSettings.key} = ${key}`)
    .returning({ value: appSettings.value });

  const after = Number(refunded?.value ?? 0);
  return { ok: false, used: after, remaining: Math.max(0, ceiling - after) };
}

/** Calls taken today, for the settings screen and the worker's logs. */
export async function callsUsed(now: Date = new Date()): Promise<number> {
  const [row] = await adminDb
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(sql`${appSettings.key} = ${PREFIX + utcDay(now)}`)
    .limit(1);
  return Number(row?.value ?? 0);
}

/** How many calls this caller may still make today. */
export async function remainingFor(
  caller: Caller,
  opts: { now?: Date; budget?: Budget } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const budget = opts.budget ?? budgetFrom();
  return Math.max(0, ceilingFor(caller, budget) - (await callsUsed(now)));
}

/**
 * Drop counters older than a week. They are a rate limit's memory, not a
 * record worth keeping, and one row per day would otherwise accumulate
 * forever in a table every page read touches.
 */
export async function cleanupBudgetCounters(now = Date.now()): Promise<void> {
  await adminDb
    .delete(appSettings)
    .where(
      and(
        like(appSettings.key, `${PREFIX}%`),
        lt(appSettings.key, PREFIX + utcDay(new Date(now - 7 * 86_400_000))),
      ),
    );
}
