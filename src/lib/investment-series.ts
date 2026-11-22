/**
 * The two lines behind the investments chart: what the portfolio was worth,
 * and what had been put into it, over the same dates.
 *
 * The gap between them IS the return, which is the whole reason they are
 * built together here rather than as two unrelated queries. Each is honest
 * about a different thing:
 *
 *   value         steps. It is only known on the days someone wrote a figure
 *                 down, and is carried forward in between — the stored series
 *                 never invents a figure for a day nobody valued. (The chart
 *                 draws a smooth curve THROUGH the recorded figures, which is
 *                 a drawing decision; it does not change what is here.)
 *   contributed   accumulates. It comes from the ledger's own transfer legs,
 *                 so it is exact on every day it changes.
 *
 * Before the first valuation the value line is `null` rather than 0: the
 * portfolio was not worth nothing then, we simply have no record. Drawing it
 * as zero would manufacture a loss the size of the first deposit.
 */
import { db } from "@/db";
import { accounts, assetValuations, transactions } from "@/db/schema";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { visibleAccounts, visibleTransactions, visibleValuations } from "@/lib/account-access";
import { excludeSplitChildren } from "@/lib/split-sql";
import { VALUATION_TYPE } from "@/lib/account-kinds";
import { toIsoDate } from "@/lib/utils";

export interface SeriesPoint {
  date: string;
  /** Portfolio value carried forward from the last figure; null before the first. */
  value: number | null;
  /** Cumulative transfer legs into the investment accounts up to this date. */
  contributed: number;
}

export interface InvestmentSeries {
  points: SeriesPoint[];
  /** Every valuation date in the window, so the chart can mark real figures. */
  valuationDates: string[];
}

/** The user's investment accounts, own and shared, as ids. */
export async function investmentAccountIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(visibleAccounts(userId), eq(accounts.type, VALUATION_TYPE)));
  return rows.map((r) => r.id);
}

/**
 * Build both lines between `from` and `to`.
 *
 * Sampled at the dates where something actually happened — every valuation and
 * every transfer inside the window, plus the two endpoints — rather than on a
 * fixed weekly grid. Both series are step functions, so this is the smallest
 * set of points that draws them exactly: a weekly grid would round deposits to
 * the wrong day and still carry more points than this on a quiet year.
 */
export async function getInvestmentSeries(
  userId: string,
  from: string,
  to: string = toIsoDate(new Date()),
): Promise<InvestmentSeries> {
  const ids = await investmentAccountIds(userId);
  if (ids.length === 0) return { points: [], valuationDates: [] };

  const [valuationRows, legRows] = await Promise.all([
    // No lower bound: the figure in force at `from` may have been written long
    // before it, and dropping it would start the line at the wrong height.
    db
      .select({
        accountId: assetValuations.accountId,
        date: assetValuations.date,
        value: assetValuations.value,
      })
      .from(assetValuations)
      .where(
        and(
          visibleValuations(userId),
          inArray(assetValuations.accountId, ids),
          lte(assetValuations.date, to),
        ),
      )
      .orderBy(asc(assetValuations.date), asc(assetValuations.createdAt)),
    // Likewise: contributions before the window still count toward the running
    // total, they just don't get their own point.
    db
      .select({ date: transactions.date, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          visibleTransactions(userId),
          inArray(transactions.accountId, ids),
          eq(transactions.type, "internal_transfer"),
          excludeSplitChildren(),
          lte(transactions.date, to),
        ),
      )
      .orderBy(asc(transactions.date)),
  ]);

  // Per account, the figures in date order — walked forward below so each
  // sample date takes the last one on or before it.
  const byAccount = new Map<string, { date: string; value: number }[]>();
  for (const row of valuationRows) {
    const list = byAccount.get(row.accountId) ?? [];
    // Same date twice means a correction was written; the later row wins, and
    // the query already ordered by createdAt.
    if (list.at(-1)?.date === row.date) list[list.length - 1] = row;
    else list.push({ date: row.date, value: row.value });
    byAccount.set(row.accountId, list);
  }

  const contributionsByDate = new Map<string, number>();
  for (const leg of legRows) {
    contributionsByDate.set(
      leg.date,
      (contributionsByDate.get(leg.date) ?? 0) + leg.amount,
    );
  }

  // The series cannot start before anything happened. Callers asking for
  // "everything" pass a floor date; taking it literally would put a point
  // decades before the first deposit and squash the whole chart against its
  // right edge, so the window opens at the earliest real event instead.
  const firstEvent = [
    valuationRows[0]?.date,
    legRows[0]?.date,
  ].filter((d): d is string => !!d).sort()[0];
  if (!firstEvent) return { points: [], valuationDates: [] };
  const start = from > firstEvent ? from : firstEvent;

  // Sample where something changed, inside the window, plus both endpoints.
  const inWindow = (d: string) => d >= start && d <= to;
  const sampleDates = new Set<string>([start, to]);
  for (const row of valuationRows) if (inWindow(row.date)) sampleDates.add(row.date);
  for (const date of contributionsByDate.keys()) if (inWindow(date)) sampleDates.add(date);
  const dates = [...sampleDates].sort();

  // Running cursors, advanced once across the whole walk rather than
  // re-scanned per point.
  const cursor = new Map<string, number>(ids.map((id) => [id, -1]));
  const held = new Map<string, number>();
  const contributionDates = [...contributionsByDate.keys()].sort();
  let legIndex = 0;
  let contributed = 0;

  const points: SeriesPoint[] = dates.map((date) => {
    for (const id of ids) {
      const list = byAccount.get(id);
      if (!list) continue;
      let i = cursor.get(id)!;
      while (i + 1 < list.length && list[i + 1].date <= date) {
        i++;
        held.set(id, list[i].value);
      }
      cursor.set(id, i);
    }
    while (
      legIndex < contributionDates.length &&
      contributionDates[legIndex] <= date
    ) {
      contributed += contributionsByDate.get(contributionDates[legIndex])!;
      legIndex++;
    }
    return {
      date,
      // Only accounts with a figure on or before this date contribute. None at
      // all means we knew nothing yet, which is null rather than zero.
      value: held.size === 0
        ? null
        : [...held.values()].reduce((sum, v) => sum + v, 0),
      contributed,
    };
  });

  return {
    points,
    valuationDates: valuationRows.filter((r) => inWindow(r.date)).map((r) => r.date),
  };
}

/** Cumulative contributions on a single date — used by the summary figures. */
export async function contributedThrough(
  userId: string,
  accountIds: string[],
  through: string,
  from?: string,
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const rows = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        visibleTransactions(userId),
        inArray(transactions.accountId, accountIds),
        eq(transactions.type, "internal_transfer"),
        excludeSplitChildren(),
        lte(transactions.date, through),
        ...(from ? [gte(transactions.date, from)] : []),
      ),
    );
  return rows.reduce((sum, r) => sum + r.amount, 0);
}
