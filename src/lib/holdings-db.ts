/**
 * Holdings against the database: load the trades and prices, derive the
 * positions, and keep the account's valuation history in step with them.
 *
 * The join between phase two and phase three lives in `recomputeAccountValuations`.
 * An account with holdings stops being valued by hand and starts being valued
 * from quantity x price — but it writes those figures into `assetValuations`
 * exactly as a person would, so the chart, net worth, the dashboard card and
 * every balance keep reading one interface and never learn that holdings exist.
 */
import { db as defaultDb } from "@/db";
import {
  assetValuations,
  instrumentPrices,
  instruments,
  trades,
  type instruments as InstrumentsTable,
} from "@/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { accounts, transactions } from "@/db/schema";
import {
  cashAtBroker,
  derivePositions,
  valuationDatesFor,
  valuePositions,
  portfolioValue,
  type TradeRow,
  type ValuedPosition,
} from "@/lib/positions";
import { syncLatestValuation, upsertValuation } from "@/lib/valuations";
import { toIsoDate } from "@/lib/utils";

export type Instrument = typeof InstrumentsTable.$inferSelect;

export interface Holding extends ValuedPosition {
  instrument: Instrument;
  /** Which account holds it: the same fund can sit in two, costing different
   *  amounts in each, so a holding is never identified by instrument alone. */
  accountId: string;
}

/** Trades and prices for one account, in the shape the pure helpers want. */
async function loadAccountData(db: typeof defaultDb, ownerId: string, accountId: string) {
  const tradeRows = await db
    .select({
      instrumentId: trades.instrumentId,
      date: trades.date,
      type: trades.type,
      quantity: trades.quantity,
      unitPrice: trades.unitPrice,
      fee: trades.fee,
    })
    .from(trades)
    .where(and(eq(trades.userId, ownerId), eq(trades.accountId, accountId)))
    .orderBy(asc(trades.date));

  const instrumentIds = [...new Set(tradeRows.map((t) => t.instrumentId))];
  if (instrumentIds.length === 0) {
    return { tradeRows: [] as TradeRow[], priceRows: [], instrumentById: new Map() };
  }

  const [priceRows, instrumentRows] = await Promise.all([
    db
      .select({
        instrumentId: instrumentPrices.instrumentId,
        date: instrumentPrices.date,
        price: instrumentPrices.price,
      })
      .from(instrumentPrices)
      .where(
        and(
          eq(instrumentPrices.userId, ownerId),
          inArray(instrumentPrices.instrumentId, instrumentIds),
        ),
      )
      .orderBy(asc(instrumentPrices.date)),
    db
      .select()
      .from(instruments)
      .where(
        and(eq(instruments.userId, ownerId), inArray(instruments.id, instrumentIds)),
      ),
  ]);

  return {
    tradeRows,
    priceRows,
    instrumentById: new Map(instrumentRows.map((i) => [i.id, i])),
  };
}

function groupPrices(rows: { instrumentId: string; date: string; price: number }[]) {
  const byInstrument = new Map<string, { date: string; price: number }[]>();
  for (const r of rows) {
    const list = byInstrument.get(r.instrumentId) ?? [];
    list.push({ date: r.date, price: r.price });
    byInstrument.set(r.instrumentId, list);
  }
  return byInstrument;
}

/**
 * One account's holdings, valued as of `asOf` (today by default).
 *
 * Closed positions come back too, with a quantity of zero: what a holding
 * realized is part of the account's story even once the units are gone, and
 * dropping it would make a profitable sale vanish from the record.
 */
export async function getAccountHoldings(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
  asOf: string = toIsoDate(new Date()),
): Promise<Holding[]> {
  const { tradeRows, priceRows, instrumentById } = await loadAccountData(
    db,
    ownerId,
    accountId,
  );
  if (tradeRows.length === 0) return [];

  const valued = valuePositions(
    derivePositions(tradeRows),
    groupPrices(priceRows),
    asOf,
  );
  return sortHoldings(
    valued
      .map((p) => ({
        ...p,
        accountId,
        instrument: instrumentById.get(p.instrumentId)!,
      }))
      .filter((h) => h.instrument),
  );
}

/** Open holdings first, biggest by value; closed ones trail behind. */
function sortHoldings(holdings: Holding[]): Holding[] {
  return [...holdings].sort((a, b) => {
    if ((a.quantity > 0) !== (b.quantity > 0)) return a.quantity > 0 ? -1 : 1;
    return (b.marketValue ?? 0) - (a.marketValue ?? 0);
  });
}

export interface AccountPositions {
  holdings: Holding[];
  /** The holdings' market value, or 0 while none of them is priced. */
  holdingsValue: number;
  /**
   * Deposited at the broker and not yet invested, or null when a trade with
   * no price makes it unknowable. Part of what the account is worth.
   */
  cash: number | null;
  /** Trades recorded without a price — what makes cost and cash unknown. */
  unpricedTrades: number;
}

/**
 * One account's holdings together with the cash beside them.
 *
 * The two travel together because they are the two halves of what a brokerage
 * account is worth, and reading them apart is how a page ends up showing a
 * value that its own parts do not add up to.
 */
export async function getAccountPositions(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
  asOf: string = toIsoDate(new Date()),
): Promise<AccountPositions> {
  const [{ tradeRows, priceRows, instrumentById }, contributions] = await Promise.all([
    loadAccountData(db, ownerId, accountId),
    loadContributions(db, ownerId, accountId),
  ]);
  if (tradeRows.length === 0) {
    return { holdings: [], holdingsValue: 0, cash: null, unpricedTrades: 0 };
  }

  const holdings = sortHoldings(
    valuePositions(derivePositions(tradeRows), groupPrices(priceRows), asOf)
      .map((p) => ({ ...p, accountId, instrument: instrumentById.get(p.instrumentId)! }))
      .filter((h) => h.instrument),
  );

  return {
    holdings,
    holdingsValue: holdings.reduce(
      (sum, h) => sum + (h.quantity > 0 ? (h.marketValue ?? 0) : 0),
      0,
    ),
    cash: cashAtBroker(contributions, tradeRows, asOf),
    unpricedTrades: tradeRows.filter(
      (t) => (t.type === "buy" || t.type === "sell") && t.unitPrice <= 0,
    ).length,
  };
}

export interface TradeRecord {
  id: string;
  accountId: string;
  accountName: string;
  instrumentId: string;
  instrumentName: string;
  date: string;
  type: "buy" | "sell" | "dividend" | "fee";
  quantity: number;
  unitPrice: number;
  fee: number;
}

/**
 * What was actually entered, newest first — the trades themselves rather than
 * the positions derived from them.
 *
 * Positions cannot be corrected; the rows behind them can, so a mistyped buy
 * needs somewhere to be seen before it can be fixed. Bounded, because this is
 * a record to scan and correct, not a history to browse.
 */
export async function listTrades(
  db: typeof defaultDb,
  /** The accounts to read, each with the id of the user whose space they live in. */
  scope: { id: string; ownerId: string }[],
  limit = 100,
): Promise<TradeRecord[]> {
  if (scope.length === 0) return [];
  const accountIds = scope.map((a) => a.id);
  const ownerIds = [...new Set(scope.map((a) => a.ownerId))];
  const rows = await db
    .select({
      id: trades.id,
      accountId: trades.accountId,
      accountName: accounts.name,
      instrumentId: trades.instrumentId,
      instrumentName: instruments.name,
      date: trades.date,
      type: trades.type,
      quantity: trades.quantity,
      unitPrice: trades.unitPrice,
      fee: trades.fee,
    })
    .from(trades)
    .innerJoin(instruments, eq(instruments.id, trades.instrumentId))
    .innerJoin(accounts, eq(accounts.id, trades.accountId))
    // Both halves, and on purpose. The accounts bound what is read; the owner
    // ids are whose space those rows live in, which is not the reader on a
    // shared account — filtering on the reader would drop exactly the trades a
    // shared account exists to show.
    .where(
      and(
        inArray(trades.userId, ownerIds),
        inArray(trades.accountId, accountIds),
      ),
    )
    .orderBy(desc(trades.date), desc(trades.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Rebuild every account of this owner that holds `instrumentId`.
 *
 * A price belongs to the instrument, not to one account: the same fund held in
 * two accounts is worth the same in both, so entering a price has to move both
 * valuations or the two would start disagreeing about the same security.
 */
export async function recomputeAccountsHolding(
  db: typeof defaultDb,
  ownerId: string,
  instrumentId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ accountId: trades.accountId })
    .from(trades)
    .where(
      and(eq(trades.userId, ownerId), eq(trades.instrumentId, instrumentId)),
    );
  for (const row of rows) {
    await recomputeAccountValuations(db, ownerId, row.accountId);
  }
  return rows.map((r) => r.accountId);
}

/**
 * Rebuild every investment account the owner has that is valued from holdings.
 *
 * Needed after an import, because an account's worth includes the cash that
 * has arrived but not been invested: a newly imported deposit changes what the
 * account is worth on the day it landed, with no trade or price involved.
 * Without this the figure would sit stale until the next time someone happened
 * to enter a price.
 *
 * Accounts with no trades are left alone — their value is whatever was typed.
 */
export async function recomputeDerivedAccounts(
  db: typeof defaultDb,
  ownerId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ accountId: trades.accountId })
    .from(trades)
    .where(eq(trades.userId, ownerId));
  for (const row of rows) {
    await recomputeAccountValuations(db, ownerId, row.accountId);
  }
  return rows.map((r) => r.accountId);
}

/**
 * Transfer legs that landed in the account — the money the trades spend.
 *
 * Read straight from the ledger rather than from anything the user typed
 * here: these are the same rows "put in" is measured from, so the cash the
 * account holds and the contributions it is compared against can never
 * disagree about what arrived.
 */
async function loadContributions(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
) {
  const rows = await db
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, ownerId),
        eq(transactions.accountId, accountId),
        eq(transactions.type, "internal_transfer"),
      ),
    )
    .orderBy(asc(transactions.date));
  return rows;
}

/** True once an account has any trade at all — its value is then derived. */
export async function accountHasHoldings(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.userId, ownerId), eq(trades.accountId, accountId)))
    .limit(1);
  return !!row;
}

/**
 * Rebuild an account's valuation history from its holdings.
 *
 * Runs on every trade and price change. It writes a row for each date the
 * account's value could have moved — a trade, or a new price for something it
 * holds — so entering a year of statements produces a year of chart rather
 * than a single point at today.
 *
 * Replaces whatever sat on those dates, including anything typed by hand:
 * once an account has holdings, quantity x price is the better answer, and
 * leaving a manual figure to win on some days would make the line jump between
 * two different ways of counting.
 *
 * Dates with no price for anything held are skipped rather than written as
 * zero — early trades often predate the first price someone enters, and a
 * zero there would draw the portfolio as worthless before it was priced.
 */
export async function recomputeAccountValuations(
  db: typeof defaultDb,
  ownerId: string,
  accountId: string,
): Promise<number> {
  const { tradeRows, priceRows } = await loadAccountData(db, ownerId, accountId);

  // Derived rows are rebuilt, never patched. Clearing them first is what makes
  // the recompute a true function of the trades: without it, a figure computed
  // for a date that is no longer an event — because the trade behind it was
  // deleted — would survive as a claim nothing supports, and deleting an
  // account's last trade would leave it still worth whatever it last was.
  //
  // Only `price` rows go. A figure someone typed before they started entering
  // trades is their record, not ours to discard.
  await db
    .delete(assetValuations)
    .where(
      and(
        eq(assetValuations.userId, ownerId),
        eq(assetValuations.accountId, accountId),
        eq(assetValuations.source, "price"),
      ),
    );

  if (tradeRows.length === 0) {
    await syncLatestValuation(db, ownerId, accountId);
    return 0;
  }

  const contributions = await loadContributions(db, ownerId, accountId);
  const pricesByInstrument = groupPrices(priceRows);
  const today = toIsoDate(new Date());
  // Deposit dates count too: money arriving at the broker changes what the
  // account is worth on the day it lands, before anything is bought with it.
  const dates = valuationDatesFor(
    [...tradeRows, ...contributions],
    priceRows,
  ).filter((d) => d <= today);
  // Always value today as well, so a portfolio whose last price is a month old
  // still reports a current figure carried forward from it.
  if (!dates.includes(today)) dates.push(today);

  const rows: { date: string; value: number }[] = [];
  for (const date of dates) {
    const upTo = tradeRows.filter((t) => t.date <= date);
    if (upTo.length === 0) continue;
    const holdingsValue = portfolioValue(
      valuePositions(derivePositions(upTo), pricesByInstrument, date),
    );
    // Nothing held has a price yet: the account's worth is genuinely unknown,
    // and the cash alone would understate it rather than estimate it.
    if (holdingsValue === null) continue;
    rows.push({
      date,
      // What the account is worth is what it holds PLUS what has arrived and
      // not been invested. Counting only the holdings makes a monthly-deposit,
      // quarterly-buy habit read as a steady loss.
      //
      // Null cash means a trade was recorded without a price, so how much of
      // the deposits is still cash cannot be worked out. The holdings are
      // still worth what they are worth, so the figure stands on them alone —
      // understated, and the page says why rather than letting the gap pass
      // as a loss.
      value: holdingsValue + (cashAtBroker(contributions, upTo, date) ?? 0),
    });
  }

  // One upsert per date rather than one bulk statement: a bulk upsert would
  // need `excluded.value` to set each row from its own payload, and that
  // means sql.raw, which this codebase bans outright. The run is bounded by
  // the dates the user actually entered — tens of rows for a household
  // portfolio — so the loop costs nothing worth buying with an escape hatch.
  for (const row of rows) {
    await upsertValuation(db, {
      ownerId,
      accountId,
      date: row.date,
      value: row.value,
      source: "price",
    });
  }

  await syncLatestValuation(db, ownerId, accountId);
  return rows.length;
}
