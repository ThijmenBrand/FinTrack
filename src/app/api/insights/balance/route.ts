import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { and, inArray, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { toIsoDate } from "@/lib/utils";
import { visibleAccounts, visibleTransactions } from "@/lib/account-access";
import { excludeSplitChildren } from "@/lib/split-sql";

/**
 * GET /api/insights/balance — daily balance time series for an account (or all accounts).
 * Query params:
 *  - accountId (optional): comma-separated account ids to include; if absent, aggregates all of the user's accounts
 *  - dateFrom (optional): start of historical window (ISO date). Defaults to the earliest transaction.
 *  - dateTo (optional): end of historical window (ISO date). Capped at today.
 *
 * Returns:
 *  - historical:   [{ date, balance }] daily end-of-day balance through histEnd
 *  - currentBalance: true balance at today, regardless of histEnd
 *  - accountName:  selected account name, or null when aggregating all
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const accountIds =
      searchParams.get("accountId")?.split(",").filter(Boolean) ?? [];
    const dateFromParam = searchParams.get("dateFrom");
    const dateToParam = searchParams.get("dateTo");

    // 1. Accounts in scope — own plus actively shared — and the ledger they
    // carry, in one round trip.
    //
    // The ledger comes back as one row per DAY, not one per transaction: the
    // chart plots a daily balance, so the per-row detail is summed away the
    // moment it arrives. A few years of history is a couple of thousand days
    // whatever the transaction count, and fetching tens of thousands of rows
    // to add them up in JS was the single largest read the insights page made.
    const acctConditions = [visibleAccounts(userId)];
    if (accountIds.length > 0)
      acctConditions.push(inArray(accounts.id, accountIds));
    // Ledger view: the split parent is the row the bank actually posted, so its
    // children are left out rather than counted on top of it.
    const txConditions = [visibleTransactions(userId), excludeSplitChildren()];
    if (accountIds.length > 0)
      txConditions.push(inArray(transactions.accountId, accountIds));

    const [acctList, dailyDeltas] = await db.batch([
      db.select().from(accounts).where(and(...acctConditions)),
      db
        .select({
          date: transactions.date,
          delta: sql<number>`sum(${transactions.amount})`,
        })
        .from(transactions)
        .where(and(...txConditions))
        .groupBy(transactions.date)
        .orderBy(transactions.date),
    ]);

    if (acctList.length === 0) {
      return NextResponse.json({
        historical: [],
        currentBalance: 0,
        accountName: null,
      });
    }

    const startingBalance = acctList.reduce(
      (s, a) => s + a.initialBalance,
      0
    );
    const accountName = accountIds.length === 1 ? acctList[0].name : null;

    // Local dates throughout: toISOString() would roll back a day east of UTC.
    const today = toIsoDate(new Date());

    // 2. Historical window. Without dateFrom the whole history is returned, so
    // the chart always covers exactly the period the page has selected.
    const earliestTx = dailyDeltas.length > 0 ? dailyDeltas[0].date : today;
    const histStart = dateFromParam || earliestTx;
    // Cap dateTo at today: the chart can't show "actual" balance for the future.
    const histEnd = dateToParam && dateToParam < today ? dateToParam : today;

    const dateToDelta = new Map<string, number>();
    for (const row of dailyDeltas) {
      dateToDelta.set(row.date, Number(row.delta) || 0);
    }

    // Running balance as of (start of) histStart: initialBalance + everything before histStart
    let runningBalance = startingBalance;
    for (const row of dailyDeltas) {
      if (row.date < histStart) {
        runningBalance += Number(row.delta) || 0;
      } else {
        break;
      }
    }

    // 3. Walk day by day, recording end-of-day balance
    const historical: { date: string; balance: number }[] = [];
    if (histEnd >= histStart) {
      const cursor = new Date(histStart + "T00:00:00");
      const stop = new Date(histEnd + "T00:00:00");
      while (cursor <= stop) {
        const dateStr = toIsoDate(cursor);
        runningBalance += dateToDelta.get(dateStr) || 0;
        historical.push({ date: dateStr, balance: runningBalance });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // 4. Current balance (always anchored at "today", regardless of histEnd)
    let currentBalance = startingBalance;
    for (const row of dailyDeltas) {
      if (row.date <= today) currentBalance += Number(row.delta) || 0;
    }

    return NextResponse.json({
      historical,
      currentBalance,
      accountName,
    });
  }, "Failed to fetch balance timeline");
}
