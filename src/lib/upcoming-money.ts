import { cache } from "react";
import { db } from "@/db";
import { accounts, categories, recurringTransactions } from "@/db/schema";
import { eq, and, or, sql, inArray } from "drizzle-orm";
import { memberAccountIds } from "@/lib/account-access";
import { generateOccurrences, isOccurrencePaid } from "@/lib/recurring";
import { lastPaidByPlan } from "@/lib/recurring-paid";
import { toIsoDate } from "@/lib/utils";
import type { UpcomingMoneyEvent, UpcomingMoneyView } from "@/types/api";

// ─── Upcoming bills & income ────────────────────────────────────────────────

/**
 * How far ahead the dashboard looks. Thirty days is the smallest window that
 * shows every monthly plan exactly once, whatever day you happen to look —
 * rent, salary and each subscription appear once and only once.
 */
const UPCOMING_WINDOW_DAYS = 30;

/**
 * How far back an occurrence nothing has settled still counts as upcoming.
 * A bill that was due on Friday and hasn't left the account is the single
 * most useful thing this card can tell you — but only for a week, after which
 * it is a bookkeeping question, not a cash-flow one.
 */
const UPCOMING_LOOKBACK_DAYS = 7;

/** Whole days from local midnight today to a YYYY-MM-DD date. */
function daysFromToday(iso: string, today: Date): number {
  return Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - today.getTime()) / 86_400_000,
  );
}

/**
 * The bills and income due in the next {@link UPCOMING_WINDOW_DAYS} days,
 * expanded from the user's active recurring plans.
 *
 * Scoped like every other read on a shared account: the caller's own plans
 * plus plans on accounts actively shared with them. `accountIds` narrows that
 * further (the dashboard passes a pinned budget's accounts); undefined means
 * every account the caller can see.
 *
 * Two kinds of row are deliberately left out:
 *  - Transfer-category plans. Moving money between your own accounts is
 *    neither a bill nor income, and counting one would make the card's totals
 *    disagree with the rows under them.
 *  - Pots with a target date. Those are the "Coming up this month" card's job;
 *    listing them here would show the same euro twice on one page.
 */
export const getUpcomingMoney = cache(async (
  userId: string,
  accountIds?: string[],
): Promise<UpcomingMoneyView> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today);
  from.setDate(from.getDate() - UPCOMING_LOOKBACK_DAYS);
  const to = new Date(today);
  to.setDate(to.getDate() + UPCOMING_WINDOW_DAYS);
  const todayIso = toIsoDate(today);

  const scope =
    accountIds === undefined
      ? undefined
      : accountIds.length > 0
        ? inArray(recurringTransactions.accountId, accountIds)
        : sql`1=0`;

  const rows = await db
    .select({
      id: recurringTransactions.id,
      description: recurringTransactions.description,
      amount: recurringTransactions.amount,
      type: recurringTransactions.type,
      frequency: recurringTransactions.frequency,
      dayOfWeek: recurringTransactions.dayOfWeek,
      dayOfMonth: recurringTransactions.dayOfMonth,
      monthOfYear: recurringTransactions.monthOfYear,
      startDate: recurringTransactions.startDate,
      endDate: recurringTransactions.endDate,
      accountId: recurringTransactions.accountId,
      accountName: accounts.name,
      categoryKind: categories.kind,
      categoryName: categories.name,
      categoryColor: categories.color,
    })
    .from(recurringTransactions)
    .leftJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
    .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
    .where(
      and(
        eq(recurringTransactions.isActive, true),
        // Rows on a shared account keep the OWNER's user_id, so a plain
        // ownership match would miss them.
        or(
          eq(recurringTransactions.userId, userId),
          inArray(recurringTransactions.accountId, memberAccountIds(userId)),
        ),
        ...(scope ? [scope] : []),
      ),
    );

  const plans = rows.filter((r) => r.categoryKind !== "transfer");
  const empty: UpcomingMoneyView = {
    events: [],
    incoming: 0,
    outgoing: 0,
    net: 0,
    planCount: plans.length,
    windowDays: UPCOMING_WINDOW_DAYS,
  };
  if (plans.length === 0) return empty;

  const lastPaid = await lastPaidByPlan(plans.map((p) => p.id), userId);

  const events: UpcomingMoneyEvent[] = [];
  for (const plan of plans) {
    for (const date of generateOccurrences(
      plan.frequency,
      plan.startDate,
      plan.endDate,
      plan.dayOfWeek,
      plan.dayOfMonth,
      plan.monthOfYear,
      from,
      to,
    )) {
      // The payment already landed — history, not forecast.
      if (isOccurrencePaid(plan.frequency, date, lastPaid.get(plan.id))) continue;
      const overdue = date < todayIso;
      // Silence from a plan only means "unpaid" once we've seen a payment
      // matched to it at least once. Without that, every past occurrence of a
      // plan whose payments never link up would cry overdue.
      if (overdue && !lastPaid.has(plan.id)) continue;
      events.push({
        key: `${plan.id}:${date}`,
        planId: plan.id,
        date,
        daysUntil: daysFromToday(date, today),
        description: plan.description,
        amount: plan.type === "income" ? Math.abs(plan.amount) : -Math.abs(plan.amount),
        type: plan.type,
        categoryName: plan.categoryName,
        categoryColor: plan.categoryColor,
        accountId: plan.accountId,
        accountName: plan.accountName,
        overdue,
      });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));

  let incoming = 0;
  let outgoing = 0;
  for (const e of events) {
    if (e.amount >= 0) incoming += e.amount;
    else outgoing += -e.amount;
  }

  return {
    ...empty,
    events,
    incoming,
    outgoing,
    net: incoming - outgoing,
  };
});
