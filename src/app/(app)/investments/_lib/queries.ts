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

    const { points, valuationDates } = await getInvestmentSeries(
      userId,
      EARLIEST,
      toIsoDate(new Date()),
    );

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
    };
  },
);

/** True when the user has any investment account at all — drives the nav item. */
export const hasInvestmentAccounts = cache(async (userId: string) =>
  (await getAccountBalances(userId)).some(isInvestmentAccount),
);
