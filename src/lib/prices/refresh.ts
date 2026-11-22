/**
 * The daily price refresh: decide what to ask for, ask, store, recompute.
 *
 * The order matters. Every filter here runs *before* a call is reserved, so an
 * instrument that is sold out, unlinked, or already priced through the last
 * close costs nothing at all. What survives the filters is then capped by the
 * remaining budget, so a portfolio larger than the plan degrades by pricing
 * the stalest holdings first rather than by failing.
 */
import { db as defaultDb } from "@/db";
import { instrumentPrices, instruments, trades } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { recomputeAccountsHolding } from "@/lib/holdings-db";
import { remainingFor } from "./budget";
import {
  PriceProviderError,
  fetchDailyCloses,
  type ClientOptions,
} from "./eodhd";
import { nextFetchFrom } from "./schedule";

/** An instrument worth spending a call on, and the date to ask from. */
export interface Candidate {
  instrumentId: string;
  symbol: string;
  /** Null when nothing is stored yet — this one needs the backfill. */
  latestPrice: string | null;
  from: string;
}

export interface RefreshOutcome {
  /** Instruments that passed every filter, before the budget cap. */
  due: number;
  /** Calls actually made. */
  called: number;
  /** Price rows written. */
  written: number;
  /** Due instruments the budget could not reach today. */
  deferred: number;
  /** Set when the provider stopped us early. */
  stoppedBy?: PriceProviderError["code"];
}

/**
 * Instruments this user holds that a provider can price.
 *
 * "Holds" is derived from the trades rather than stored: a position sold down
 * to zero keeps its history and its row in the holdings table, but nobody
 * needs today's price for a fund they no longer own, and on a 20-call plan
 * that distinction is the difference between affording the portfolio and not.
 */
export async function dueInstruments(
  db: typeof defaultDb,
  userId: string,
  now: Date,
): Promise<Candidate[]> {
  const held = await db
    .select({
      instrumentId: instruments.id,
      symbol: instruments.symbol,
      quantity: sql<number>`SUM(CASE
        WHEN ${trades.type} = 'buy' THEN ${trades.quantity}
        WHEN ${trades.type} = 'sell' THEN -${trades.quantity}
        ELSE 0 END)`,
      // Scoped by user as well as by instrument. Instrument ids are already
      // per user, so this changes no result — but the tenant tripwire only
      // reads the statement as text, and a subquery that does not say user_id
      // is the shape it cannot help with.
      latestPrice: sql<string | null>`(
        SELECT MAX(${instrumentPrices.date}) FROM ${instrumentPrices}
        WHERE ${instrumentPrices.instrumentId} = ${instruments.id}
          AND ${instrumentPrices.userId} = ${userId}
      )`,
    })
    .from(instruments)
    .innerJoin(trades, eq(trades.instrumentId, instruments.id))
    .where(
      and(
        eq(instruments.userId, userId),
        eq(trades.userId, userId),
        eq(instruments.dataSource, "eodhd"),
      ),
    )
    .groupBy(instruments.id);

  const candidates: Candidate[] = [];
  for (const row of held) {
    // Dust rather than zero: selling everything leaves rounding behind.
    if (!row.symbol || row.quantity <= 0.000001) continue;
    const from = nextFetchFrom(row.latestPrice, now);
    if (!from) continue;
    candidates.push({
      instrumentId: row.instrumentId,
      symbol: row.symbol,
      latestPrice: row.latestPrice,
      from,
    });
  }

  // Stalest first. When the budget cannot cover everything, the holding that
  // has gone longest without a price is the one most worth a call — and this
  // ordering is what stops the same instruments losing the race every day.
  return candidates.sort((a, b) =>
    (a.latestPrice ?? "").localeCompare(b.latestPrice ?? ""),
  );
}

/**
 * Store what came back, then rebuild the valuations that depend on it.
 *
 * The recompute is per instrument and only when rows actually landed: it walks
 * every account holding the fund, and running it for an instrument whose price
 * did not move would be work with no new answer.
 */
export async function storeCloses(
  db: typeof defaultDb,
  userId: string,
  instrumentId: string,
  rows: { date: string; close: number }[],
): Promise<number> {
  if (rows.length === 0) return 0;

  // In chunks, because the first fetch for an instrument is years of history:
  // a statement per day would be thousands of round trips with a person
  // waiting on the dialog. The bound keeps the parameter count inside
  // SQLite's limit whatever the range turns out to be.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(instrumentPrices)
      .values(
        rows.slice(i, i + CHUNK).map((row) => ({
          userId,
          instrumentId,
          date: row.date,
          price: row.close,
          source: "provider" as const,
        })),
      )
      .onConflictDoUpdate({
        target: [instrumentPrices.instrumentId, instrumentPrices.date],
        // The provider wins over a figure typed earlier for the same day: it
        // is the same claim from a better source, and leaving the manual row
        // would make one day of the chart disagree with its neighbours.
        set: {
          price: sql`excluded.price`,
          source: "provider",
        },
      });
  }

  await recomputeAccountsHolding(db, userId, instrumentId);
  return rows.length;
}

/**
 * Refresh every due instrument the budget allows.
 *
 * Stops cleanly on `budget_exhausted` rather than carrying on and collecting
 * errors: once the plan says no, every further call this day gets the same
 * answer, and hammering it would spend the per-minute limit too.
 */
export async function refreshPrices(
  db: typeof defaultDb,
  userId: string,
  opts: ClientOptions & { now?: Date } = {},
): Promise<RefreshOutcome> {
  const now = opts.now ?? new Date();
  const due = await dueInstruments(db, userId, now);
  const allowance = await remainingFor("background", { now });
  const take = due.slice(0, allowance);

  const outcome: RefreshOutcome = {
    due: due.length,
    called: 0,
    written: 0,
    deferred: due.length - take.length,
  };

  for (const [index, candidate] of take.entries()) {
    try {
      const rows = await fetchDailyCloses(candidate.symbol, candidate.from, {
        ...opts,
        now,
        caller: "background",
      });
      outcome.called++;
      outcome.written += await storeCloses(db, userId, candidate.instrumentId, rows);
    } catch (error) {
      if (!(error instanceof PriceProviderError)) throw error;
      // No token means the request never left, so no call was spent and no
      // amount of trying will change it. That is the operator's problem, not
      // this run's: rethrow, so the job is marked as needing action instead of
      // walking the whole list to discover the same thing once per holding.
      if (error.code === "not_configured") throw error;
      // A call was still spent on anything the provider answered at all.
      if (error.code !== "budget_exhausted") outcome.called++;
      outcome.stoppedBy = error.code;
      if (error.code === "budget_exhausted" || error.code === "key_rejected") {
        // Both are terminal for today. Counted from where we stopped, not from
        // the calls made: the one that just failed was attempted, not deferred.
        outcome.deferred = due.length - index - 1;
        break;
      }
      // A single bad symbol (delisted, renamed) must not stop the others.
    }
  }

  return outcome;
}
