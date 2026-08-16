import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { and, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { toIsoDate } from "@/lib/utils";
import { visibleAccounts, visibleTransactions } from "@/lib/account-access";

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

    // 1. Accounts in scope — own plus actively shared.
    const acctConditions = [visibleAccounts(userId)];
    if (accountIds.length > 0)
      acctConditions.push(inArray(accounts.id, accountIds));
    const acctList = await db
      .select()
      .from(accounts)
      .where(and(...acctConditions));

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

    // 2. Fetch all transactions for in-scope accounts
    const txConditions = [visibleTransactions(userId)];
    if (accountIds.length > 0)
      txConditions.push(inArray(transactions.accountId, accountIds));
    const allTx = await db
      .select({ date: transactions.date, amount: transactions.amount })
      .from(transactions)
      .where(and(...txConditions))
      .orderBy(transactions.date);

    // Local dates throughout: toISOString() would roll back a day east of UTC.
    const today = toIsoDate(new Date());

    // 3. Historical window. Without dateFrom the whole history is returned, so
    // the chart always covers exactly the period the page has selected.
    const earliestTx = allTx.length > 0 ? allTx[0].date : today;
    const histStart = dateFromParam || earliestTx;
    // Cap dateTo at today: the chart can't show "actual" balance for the future.
    const histEnd = dateToParam && dateToParam < today ? dateToParam : today;

    // Aggregate transaction amounts per date
    const dateToDelta = new Map<string, number>();
    for (const tx of allTx) {
      dateToDelta.set(tx.date, (dateToDelta.get(tx.date) || 0) + tx.amount);
    }

    // Running balance as of (start of) histStart: initialBalance + everything before histStart
    let runningBalance = startingBalance;
    for (const tx of allTx) {
      if (tx.date < histStart) {
        runningBalance += tx.amount;
      } else {
        break;
      }
    }

    // Walk day by day, recording end-of-day balance
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
    for (const tx of allTx) {
      if (tx.date <= today) currentBalance += tx.amount;
    }

    return NextResponse.json({
      historical,
      currentBalance,
      accountName,
    });
  }, "Failed to fetch balance timeline");
}
