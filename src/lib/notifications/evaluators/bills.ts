import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAccountLinks } from "@/db/schema";
import { getAccountBalances } from "@/lib/account-balances";
import { getUpcomingMoney } from "@/lib/upcoming-money";
import type { UpcomingMoneyEvent } from "@/types/api";
import type { NotificationData } from "../registry";
import { draft } from "../dispatch";
import type { Evaluator } from "./types";

/** How many days ahead a bill counts. */
export const BILL_HORIZON_DAYS = 3;
/** A bank-reported balance older than this is stale; the computed one is used instead. */
const BANK_BALANCE_FRESH_MS = 24 * 3_600_000;

export interface BalanceAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
}

export type Shortfall = NotificationData["bills.low_balance"];

/**
 * Per account: start from today's balance and walk the plans due in the next
 * few days in date order (income before bills on the same day — salary and
 * rent on the 25th is the normal case, not an emergency). The first bill that
 * takes the account below zero is the warning, with every bill up to it.
 *
 * Overdue occurrences are left out: nothing settled against them, which more
 * often means the plan's matching is off than that the money is still coming.
 * Credit accounts are left out: below zero is their normal state.
 */
export function findShortfalls(
  events: Pick<UpcomingMoneyEvent, "accountId" | "date" | "daysUntil" | "amount" | "description" | "overdue">[],
  accounts: BalanceAccount[],
  horizonDays = BILL_HORIZON_DAYS,
): Shortfall[] {
  const out: Shortfall[] = [];
  for (const account of accounts) {
    if (account.type === "credit") continue;
    const due = events
      .filter((e) => e.accountId === account.id && !e.overdue && e.daysUntil >= 0 && e.daysUntil <= horizonDays)
      .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    if (!due.some((e) => e.amount < 0)) continue;

    let running = account.balance;
    const bills: Shortfall["bills"] = [];
    for (const e of due) {
      running += e.amount;
      if (e.amount >= 0) continue;
      bills.push({ description: e.description, amount: -e.amount, date: e.date });
      if (running < -0.005) {
        out.push({
          accountId: account.id,
          accountName: account.name,
          balance: account.balance,
          shortfall: -running,
          date: e.date,
          bills,
        });
        break;
      }
    }
  }
  return out;
}

export const billsEvaluator: Evaluator = {
  types: ["bills.low_balance"],
  async run(ctx) {
    const [upcoming, balances, links] = await Promise.all([
      getUpcomingMoney(ctx.userId),
      getAccountBalances(ctx.userId),
      db
        .select({
          accountId: bankAccountLinks.accountId,
          bankBalance: bankAccountLinks.bankBalance,
          bankBalanceAt: bankAccountLinks.bankBalanceAt,
        })
        .from(bankAccountLinks)
        .where(eq(bankAccountLinks.userId, ctx.userId)),
    ]);
    if (upcoming.events.length === 0) return [];

    // The bank's own figure beats ours when it is fresh: it already knows
    // about card payments that haven't been booked yet.
    const bankBalance = new Map<string, number>();
    for (const l of links) {
      if (l.bankBalance === null || !l.bankBalanceAt) continue;
      if (ctx.now.getTime() - Date.parse(l.bankBalanceAt) > BANK_BALANCE_FRESH_MS) continue;
      bankBalance.set(l.accountId, l.bankBalance);
    }
    const accounts = balances.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: bankBalance.get(a.id) ?? a.currentBalance,
    }));

    return findShortfalls(upcoming.events, accounts).map((s) =>
      draft("bills.low_balance", s, `bills.low_balance:${s.accountId}:${s.date}`),
    );
  },
};
