/**
 * Everything the investments page reads, in one pass.
 *
 * The page's job is to put two numbers next to each other honestly — what the
 * portfolio is worth, and what was put into it — so both come from here
 * together rather than from whichever query each component felt like running.
 */
import { cache } from "react";
import { getAccountBalances } from "@/lib/account-balances";
import {
  isCashAccount,
  isInvestmentAccount,
  isValuationStale,
  sumCashBalances,
} from "@/lib/account-kinds";
import { getInvestmentSeries, type SeriesPoint } from "@/lib/investment-series";
import { db } from "@/db";
import {
  getAccountPositions,
  listTrades,
  type Holding,
  type TradeRecord,
} from "@/lib/holdings-db";
import { getInvestmentSummary } from "../../_lib/dashboard-queries";
import { toIsoDate } from "@/lib/utils";

export interface InvestmentAccountRow {
  id: string;
  name: string;
  bank: string | null;
  bankName: string | null;
  currentValue: number | null;
  valuedAt: string | null;
  contributed: number;
  /** Value minus contributions; null while either is unknowable. */
  gain: number | null;
  stale: boolean;
}

export interface InvestmentsOverview {
  accounts: InvestmentAccountRow[];
  totalValue: number;
  totalContributed: number;
  investedThisYear: number;
  /** Portfolio total minus what went in; null until there is anything to compare. */
  gain: number | null;
  gainPercent: number | null;
  valuedAt: string | null;
  stale: boolean;
  everValued: boolean;
  /** Cash side of net worth, so the page can show the sum as arithmetic. */
  cash: number;
  netWorth: number;
  points: SeriesPoint[];
  valuationDates: string[];
  /** Every holding across every investment account, open and closed. */
  holdings: Holding[];
  /**
   * Open, priced holdings grouped by asset class, plus a "cash" slice for
   * money deposited at the broker but not yet invested. Empty without holdings.
   */
  allocation: { key: string; value: number }[];
  /** Deposited but uninvested, part of what the accounts are worth. */
  brokerCash: number;
  /**
   * True when a trade with no price makes the cash figure unknowable, so the
   * page can say the value is holdings only rather than letting the missing
   * money read as a loss.
   */
  brokerCashUnknown: boolean;
  /** How many trades were recorded without a price. Zero in a clean ledger. */
  unpricedTrades: number;
  /** What was entered, newest first, so a mistyped trade can be corrected. */
  trades: TradeRecord[];
  /**
   * True once any account carries trades. Its value is then derived from
   * quantity x price, and typing a figure by hand would be overwritten on the
   * next recompute — so the UI stops offering to.
   */
  derivedFromHoldings: boolean;
}

/**
 * The window the chart covers: from the first thing that ever happened —
 * earliest deposit or earliest valuation — through today. The client slices
 * it down to 1M/3M/1Y; sending the whole history once beats a round trip per
 * range on a series this small.
 */
const EARLIEST = "1970-01-01";

export const getInvestmentsOverview = cache(
  async (userId: string): Promise<InvestmentsOverview | null> => {
    const [summary, balances] = await Promise.all([
      getInvestmentSummary(userId),
      getAccountBalances(userId),
    ]);
    if (!summary) return null;

    const [{ points, valuationDates }, positionsPerAccount, trades] =
      await Promise.all([
        getInvestmentSeries(userId, EARLIEST, toIsoDate(new Date())),
        // Per account rather than one query: positions are derived by walking
        // one account's trades in order, and merging two accounts' trades would
        // average their cost bases together into a figure belonging to neither.
        Promise.all(
          summary.accounts.map((a) => getAccountPositions(db, a.ownerId, a.id)),
        ),
        listTrades(
          db,
          summary.accounts.map((a) => ({ id: a.id, ownerId: a.ownerId })),
        ),
      ]);
    const holdings = positionsPerAccount.flatMap((p) => p.holdings);

    const byClass = new Map<string, number>();
    for (const h of holdings) {
      if (h.quantity <= 0 || h.marketValue === null) continue;
      const key = h.instrument.assetClass;
      byClass.set(key, (byClass.get(key) ?? 0) + h.marketValue);
    }
    // Cash comes from the ledger's own arithmetic — deposits in, trades out —
    // not from subtracting the holdings off the valuation. The subtraction
    // would only ever restate the figure the valuation was built from, so it
    // could never disagree with it, and a missing deposit would show up as
    // nothing at all instead of as the gap it is.
    const accountCash = positionsPerAccount.map((p) => p.cash);
    const brokerCash = accountCash.reduce<number>((sum, c) => sum + (c ?? 0), 0);
    const unpricedTrades = positionsPerAccount.reduce(
      (sum, p) => sum + p.unpricedTrades,
      0,
    );
    // Shown as its own slice rather than folded in silently: "20% of my
    // portfolio is still cash" is one of the few things an allocation chart is
    // actually for.
    if (brokerCash > 0.005) {
      byClass.set("cash", (byClass.get("cash") ?? 0) + brokerCash);
    }
    const allocation = [...byClass].map(([key, value]) => ({ key, value }));

    const accounts: InvestmentAccountRow[] = summary.accounts.map((a) => ({
      ...a,
      // Return needs both halves. Without a valuation there is nothing to
      // compare; without contributions the whole value would read as profit,
      // which is missing transfers rather than a result.
      gain:
        a.currentValue !== null && a.contributed > 0
          ? a.currentValue - a.contributed
          : null,
      stale: isValuationStale(a.valuedAt),
    }));

    const everValued = accounts.some((a) => a.currentValue !== null);
    const gain =
      everValued && summary.totalContributed > 0
        ? summary.totalValue - summary.totalContributed
        : null;
    const cash = sumCashBalances(balances.filter(isCashAccount));

    return {
      accounts,
      totalValue: summary.totalValue,
      totalContributed: summary.totalContributed,
      investedThisYear: summary.investedThisYear,
      gain,
      gainPercent:
        gain !== null && summary.totalContributed > 0
          ? (gain / summary.totalContributed) * 100
          : null,
      valuedAt: summary.valuedAt,
      stale: summary.stale,
      everValued,
      cash,
      netWorth: cash + summary.totalValue,
      points,
      valuationDates,
      holdings,
      allocation,
      brokerCash,
      brokerCashUnknown: unpricedTrades > 0,
      unpricedTrades,
      trades,
      derivedFromHoldings: holdings.length > 0,
    };
  },
);

/** True when the user has any investment account at all — drives the nav item. */
export const hasInvestmentAccounts = cache(async (userId: string) =>
  (await getAccountBalances(userId)).some(isInvestmentAccount),
);
