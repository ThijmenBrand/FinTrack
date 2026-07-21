import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  accounts,
  transactions,
  recurringTransactions,
  transactionGroups,
} from "@/db/schema";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { generateOccurrences } from "@/lib/recurring";

/**
 * GET /api/insights/balance — daily balance time series for an account (or all accounts).
 * Query params:
 *  - accountId (optional): comma-separated account ids to include; if absent, aggregates all of the user's accounts
 *  - dateFrom (optional): start of historical window (ISO date). Defaults to ~6 months ago.
 *  - dateTo (optional): end of historical window (ISO date). Capped at today.
 *    When dateTo is strictly before today, the projection is omitted — the chart
 *    is showing a fully-past window where forecasting is meaningless.
 *  - forecastMonths (optional, default 3, max 12): how many months of projection to return after today
 *
 * Returns:
 *  - historical:   [{ date, balance }] daily end-of-day balance through histEnd
 *  - projected:    [{ date, balance }] daily projected balance from tomorrow onward (first point = today as anchor); empty for past windows
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
    const forecastMonths = Math.min(
      12,
      Math.max(1, Number(searchParams.get("forecastMonths")) || 3)
    );

    // 1. Accounts in scope
    const acctConditions = [eq(accounts.userId, userId)];
    if (accountIds.length > 0)
      acctConditions.push(inArray(accounts.id, accountIds));
    const acctList = await db
      .select()
      .from(accounts)
      .where(and(...acctConditions));

    if (acctList.length === 0) {
      return NextResponse.json({
        historical: [],
        projected: [],
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
    const txConditions = [eq(transactions.userId, userId)];
    if (accountIds.length > 0)
      txConditions.push(inArray(transactions.accountId, accountIds));
    const allTx = await db
      .select({ date: transactions.date, amount: transactions.amount })
      .from(transactions)
      .where(and(...txConditions))
      .orderBy(transactions.date);

    const today = new Date().toISOString().slice(0, 10);

    // 3. Historical window
    // Default historical start: 6 months before today, or earliest tx if later
    const sixMonthsAgo = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      return d.toISOString().slice(0, 10);
    })();
    const earliestTx = allTx.length > 0 ? allTx[0].date : today;
    const histStart =
      dateFromParam ||
      (earliestTx > sixMonthsAgo ? earliestTx : sixMonthsAgo);
    // Cap dateTo at today: the chart can't show "actual" balance for the future.
    const histEnd = dateToParam && dateToParam < today ? dateToParam : today;
    const includeProjection = histEnd >= today;

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
        const dateStr = cursor.toISOString().slice(0, 10);
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

    // 5. Projection from tomorrow forward — skipped when the chart window is fully in the past.
    const projected: { date: string; balance: number }[] = [];
    if (includeProjection) {
      const todayDate = new Date(today + "T00:00:00");
      const forecastFrom = new Date(
        todayDate.getFullYear(),
        todayDate.getMonth(),
        todayDate.getDate() + 1
      );
      const forecastTo = new Date(
        todayDate.getFullYear(),
        todayDate.getMonth() + forecastMonths + 1,
        0
      );

      const recurringConditions = [
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.isActive, true),
      ];
      if (accountIds.length > 0) {
        recurringConditions.push(
          inArray(recurringTransactions.accountId, accountIds)
        );
      }
      const recurring = await db
        .select({
          amount: recurringTransactions.amount,
          type: recurringTransactions.type,
          frequency: recurringTransactions.frequency,
          dayOfWeek: recurringTransactions.dayOfWeek,
          dayOfMonth: recurringTransactions.dayOfMonth,
          monthOfYear: recurringTransactions.monthOfYear,
          startDate: recurringTransactions.startDate,
          endDate: recurringTransactions.endDate,
        })
        .from(recurringTransactions)
        .where(and(...recurringConditions));

      const projectedDelta = new Map<string, number>();
      for (const r of recurring) {
        const occurrences = generateOccurrences(
          r.frequency,
          r.startDate,
          r.endDate,
          r.dayOfWeek,
          r.dayOfMonth,
          r.monthOfYear,
          forecastFrom,
          forecastTo
        );
        const signed =
          r.type === "income" ? Math.abs(r.amount) : -Math.abs(r.amount);
        for (const d of occurrences) {
          projectedDelta.set(d, (projectedDelta.get(d) || 0) + signed);
        }
      }

      // Spikes (transaction groups with target dates) — only when no account filter,
      // since spikes aren't bound to a specific account.
      if (accountIds.length === 0) {
        const forecastFromIso = forecastFrom.toISOString().slice(0, 10);
        const forecastToIso = forecastTo.toISOString().slice(0, 10);
        const spikes = await db
          .select({
            targetAmount: transactionGroups.targetAmount,
            targetDate: transactionGroups.targetDate,
          })
          .from(transactionGroups)
          .where(
            and(
              eq(transactionGroups.userId, userId),
              isNotNull(transactionGroups.targetAmount),
              isNotNull(transactionGroups.targetDate),
              gte(transactionGroups.targetDate, forecastFromIso),
              lte(transactionGroups.targetDate, forecastToIso)
            )
          );
        for (const s of spikes) {
          if (s.targetAmount == null || !s.targetDate) continue;
          projectedDelta.set(
            s.targetDate,
            (projectedDelta.get(s.targetDate) || 0) - Math.abs(s.targetAmount)
          );
        }
      }

      projected.push({ date: today, balance: currentBalance });
      let projBalance = currentBalance;
      const pCursor = new Date(forecastFrom);
      while (pCursor <= forecastTo) {
        const dateStr = pCursor.toISOString().slice(0, 10);
        projBalance += projectedDelta.get(dateStr) || 0;
        projected.push({ date: dateStr, balance: projBalance });
        pCursor.setDate(pCursor.getDate() + 1);
      }
    }

    return NextResponse.json({
      historical,
      projected,
      currentBalance,
      accountName,
    });
  }, "Failed to fetch balance timeline");
}
