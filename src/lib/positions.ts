/**
 * Positions, derived from trades. Nothing here is stored.
 *
 * A held quantity is never written to the database, because the moment it is
 * there are two answers to "how much do I own" and the first corrected trade
 * makes them disagree. Trades are the record; everything below is arithmetic
 * over them, recomputed on every read.
 *
 * Cost basis is AVERAGE COST, not FIFO. Selling a quarter of a holding
 * removes a quarter of what it cost, and the remaining units keep the same
 * average price. This is what Dutch brokers report and what every household
 * tracker shows; FIFO lots matter for jurisdictions that tax per lot, which
 * is not what this app is for. Stated here because the choice is invisible in
 * the output and wrong-looking to anyone expecting the other one.
 */

export type TradeType = "buy" | "sell" | "dividend" | "fee";

export interface TradeRow {
  instrumentId: string;
  date: string;
  type: TradeType;
  quantity: number;
  unitPrice: number;
  fee: number;
}

export interface Position {
  instrumentId: string;
  /** Units held now. Zero means the holding was closed, not that it never was. */
  quantity: number;
  /** What the units still held cost, fees included. Meaningless while `costKnown` is false. */
  costBasis: number;
  /**
   * False once a buy or sell was recorded without a price.
   *
   * A trade with no price is a gap in the record, not a free holding, and the
   * two have to be told apart: treating the gap as a cost of zero reports the
   * whole market value as profit, which is the most flattering possible lie
   * about a position. Everything derived from cost — the average price, the
   * unrealized gain, how much of the deposit is still cash — goes null
   * instead, and says so.
   */
  costKnown: boolean;
  /** costBasis / quantity, or null for a closed holding or an unknown cost. */
  averagePrice: number | null;
  /** Profit already taken: sale proceeds minus the average cost of what went. */
  realized: number;
  dividends: number;
  fees: number;
}

export interface ValuedPosition extends Position {
  /** The latest price on or before the valuation date, or null if never priced. */
  price: number | null;
  priceDate: string | null;
  /** quantity x price, or null while unpriced. */
  marketValue: number | null;
  /** marketValue - costBasis, or null while unpriced or while the cost is unknown. */
  unrealized: number | null;
  /** Unrealized plus everything already banked. The honest total for a holding. */
  totalReturn: number | null;
}

/** Half a cent: float money, so a holding this small is sold out, not held. */
const DUST = 0.005;

/**
 * Walk trades in date order into one position per instrument.
 *
 * Order matters: a sell has to know the average price at the moment it
 * happened, so trades are sorted before the walk rather than grouped and
 * summed. Summing would let a later buy at a different price change what an
 * earlier sale realized.
 */
export function derivePositions(trades: TradeRow[]): Map<string, Position> {
  const sorted = [...trades].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1,
  );
  const positions = new Map<string, Position>();

  const get = (instrumentId: string): Position => {
    let p = positions.get(instrumentId);
    if (!p) {
      p = {
        instrumentId,
        quantity: 0,
        costBasis: 0,
        costKnown: true,
        averagePrice: null,
        realized: 0,
        dividends: 0,
        fees: 0,
      };
      positions.set(instrumentId, p);
    }
    return p;
  };

  for (const t of sorted) {
    const p = get(t.instrumentId);
    switch (t.type) {
      case "buy": {
        // No price on the buy means nobody wrote down what it cost. The units
        // are still held — the quantity is real — but every figure measured
        // against cost is now unknown for this holding.
        if (t.unitPrice <= 0) p.costKnown = false;
        // The fee is part of what the units cost: it is money that left to
        // acquire them, and leaving it out would overstate every return.
        p.costBasis += t.quantity * t.unitPrice + t.fee;
        p.quantity += t.quantity;
        p.fees += t.fee;
        break;
      }
      case "sell": {
        // Likewise for a sale with no price: what it realized is unrecorded,
        // and so is what came back into cash.
        if (t.unitPrice <= 0) p.costKnown = false;
        const avg = p.quantity > DUST ? p.costBasis / p.quantity : 0;
        // Never sell more than is held, however the trade was typed — a
        // negative holding is not a thing a household account can have.
        const sold = Math.min(t.quantity, p.quantity);
        const proceeds = sold * t.unitPrice - t.fee;
        p.realized += proceeds - sold * avg;
        p.costBasis -= sold * avg;
        p.quantity -= sold;
        p.fees += t.fee;
        break;
      }
      case "dividend": {
        // Income, not a change in what the holding cost. Folding it into cost
        // basis would quietly shrink the position's apparent price.
        p.dividends += t.unitPrice - t.fee;
        p.fees += t.fee;
        break;
      }
      case "fee": {
        p.fees += t.fee;
        p.realized -= t.fee;
        break;
      }
    }
  }

  for (const p of positions.values()) {
    if (p.quantity <= DUST) {
      // Float arithmetic leaves crumbs behind a full sale. Treat them as the
      // zero they mean, so a closed holding does not linger at 0.0000001
      // units with a cost basis of a tenth of a cent.
      p.quantity = 0;
      p.costBasis = 0;
      p.averagePrice = null;
    } else {
      p.averagePrice = p.costKnown ? p.costBasis / p.quantity : null;
    }
  }
  return positions;
}

/** The newest price on or before `date`, carried forward like a valuation. */
export function priceAsOf(
  prices: { date: string; price: number }[],
  date: string,
): { price: number; date: string } | null {
  let best: { price: number; date: string } | null = null;
  for (const p of prices) {
    if (p.date <= date && (best === null || p.date > best.date)) best = p;
  }
  return best;
}

/**
 * Put a price against each position.
 *
 * A holding nobody has priced stays null rather than falling back to its
 * purchase price: showing cost as value would report a return of exactly zero
 * on an instrument we know nothing current about, which is a claim, not a gap.
 */
export function valuePositions(
  positions: Map<string, Position>,
  pricesByInstrument: Map<string, { date: string; price: number }[]>,
  asOf: string,
): ValuedPosition[] {
  return [...positions.values()].map((p) => {
    const found = priceAsOf(pricesByInstrument.get(p.instrumentId) ?? [], asOf);
    const marketValue = found ? p.quantity * found.price : null;
    const unrealized =
      marketValue === null || !p.costKnown ? null : marketValue - p.costBasis;
    return {
      ...p,
      price: found?.price ?? null,
      priceDate: found?.date ?? null,
      marketValue,
      unrealized,
      totalReturn:
        unrealized === null ? null : unrealized + p.realized + p.dividends,
    };
  });
}

/**
 * What the holdings in an account are worth on a date, or null when none of
 * them has a price yet.
 *
 * Open positions only. A holding sold down to nothing contributes nothing to
 * what the account is worth today, however much it once did.
 */
export function portfolioValue(valued: ValuedPosition[]): number | null {
  const open = valued.filter((p) => p.quantity > 0);
  if (open.length === 0) return open.length === valued.length ? null : 0;
  if (open.every((p) => p.marketValue === null)) return null;
  return open.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
}

/**
 * What a trade moved in or out of the broker's cash, as a signed amount.
 *
 * Buying spends cash, selling and dividends return it, fees take it. This is
 * the other half of what a brokerage account is worth: money that has arrived
 * but has not been put to work yet is still money, and leaving it out makes a
 * monthly-deposit-quarterly-buy habit look like a steady loss.
 */
export function cashFlowOf(t: TradeRow): number {
  switch (t.type) {
    case "buy":
      return -(t.quantity * t.unitPrice + t.fee);
    case "sell":
      return t.quantity * t.unitPrice - t.fee;
    case "dividend":
      return t.unitPrice - t.fee;
    case "fee":
      return -t.fee;
  }
}

/**
 * True while every buy and sell says what it cost or fetched.
 *
 * One priceless trade is enough to make the cash figure a fiction: the trade
 * appears to have spent nothing, so every euro that funded it still looks
 * like it is sitting at the broker.
 */
export function spendIsKnown(trades: TradeRow[]): boolean {
  return trades.every(
    (t) => (t.type !== "buy" && t.type !== "sell") || t.unitPrice > 0,
  );
}

/**
 * Cash sitting at the broker on a date: what was transferred in, minus what
 * the trades have spent of it.
 *
 * Null when a trade in scope was recorded without a price. The subtraction is
 * only as good as what the trades admit to spending, and a buy with no price
 * would hand back the whole deposit as "uninvested" — money the account does
 * not have. Unknown is the honest answer there, and the callers show it as a
 * gap rather than quietly counting zero.
 *
 * Otherwise clamped at zero. A negative result means trades were entered
 * without the transfers that funded them — common when someone types in a
 * portfolio before importing a bank statement — and showing the account as
 * owing money would be a worse lie than showing it as holding none.
 */
export function cashAtBroker(
  contributions: { date: string; amount: number }[],
  trades: TradeRow[],
  asOf: string,
): number | null {
  const upTo = trades.filter((t) => t.date <= asOf);
  if (!spendIsKnown(upTo)) return null;
  const paidIn = contributions
    .filter((c) => c.date <= asOf)
    .reduce((sum, c) => sum + c.amount, 0);
  const spent = upTo.reduce((sum, t) => sum + cashFlowOf(t), 0);
  return Math.max(0, paidIn + spent);
}

/**
 * Every date on which an account's value could have changed: a trade, or a
 * new price for something it holds. Used to rebuild the valuation history
 * from holdings, so the chart gets a real line rather than one point per time
 * someone happened to open the app.
 */
export function valuationDatesFor(
  trades: { date: string }[],
  prices: { date: string }[],
): string[] {
  return [...new Set([...trades, ...prices].map((r) => r.date))].sort();
}
