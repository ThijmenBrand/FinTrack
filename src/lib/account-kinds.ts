/**
 * Cash accounts versus valuation accounts.
 *
 * Every account type but one carries a *ledger* balance: `initialBalance +
 * SUM(transactions)`, exact, with every euro traceable back to a bank row.
 * That is what makes "every euro reconciles" true across the dashboard, the
 * budget and the insights timeline.
 *
 * An `investment` account carries a *valuation* instead: a number the user
 * typed in, true only as of a date, which moves on its own as markets move
 * without any transaction ever being written. The two are different kinds of
 * fact and must not be summed into one figure, because a total that drifts
 * with the AEX cannot be reconciled against anything.
 *
 * So the rule this module exists to enforce: valuation accounts stay out of
 * cash totals, out of the budget, out of the balance timeline and out of
 * low-balance warnings. They meet cash in exactly one place — an explicit net
 * worth figure that shows the two numbers and their sum side by side.
 *
 * Transfers are the deliberate exception. Money moving from checking into a
 * broker is still an internal transfer and still pairs through
 * `detectTransfers`, because that pairing is what keeps a €500 ETF purchase
 * out of October's spending. The ledger side of an investment account is
 * real; only its *balance* is not.
 */
import { ne } from "drizzle-orm";
import { accounts } from "@/db/schema";

/** Account types whose balance is a typed-in valuation, not a ledger sum. */
export const VALUATION_TYPE = "investment" as const;

/**
 * How long a valuation stays believable. Past this, the figure is shown with
 * its age in amber rather than quietly presented as current — a stale number
 * that looks live is the one way this feature can mislead.
 */
export const VALUATION_STALE_DAYS = 35;

export function isInvestmentAccount(account: { type: string }): boolean {
  return account.type === VALUATION_TYPE;
}

export function isCashAccount(account: { type: string }): boolean {
  return account.type !== VALUATION_TYPE;
}

/**
 * Drizzle predicate for "cash accounts only". Use it in any query whose result
 * is added up as money you hold today.
 */
export function cashAccountsOnly() {
  return ne(accounts.type, VALUATION_TYPE);
}

/** Cash balances only — what the dashboard means by "total balance". */
export function sumCashBalances(
  rows: { type: string; currentBalance: number }[],
): number {
  return rows.reduce(
    (total, row) => (isCashAccount(row) ? total + row.currentBalance : total),
    0,
  );
}

/**
 * Portfolio value: the valuation accounts only. An account that has never been
 * valued contributes nothing rather than a confident zero.
 */
export function sumInvestmentValues(
  rows: { type: string; currentValue: number | null }[],
): number {
  return rows.reduce(
    (total, row) =>
      isInvestmentAccount(row) ? total + (row.currentValue ?? 0) : total,
    0,
  );
}

/**
 * Whole days between a valuation date and `now`, or null when never valued.
 * Negative ages (a date typed in the future) clamp to 0 — "today" is the most
 * current a figure can honestly claim to be.
 */
export function valuationAgeDays(
  valuedAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!valuedAt) return null;
  const then = Date.parse(`${valuedAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

/**
 * True when a valuation is old enough to flag. A never-valued account counts
 * as stale: it needs the same nudge, for the same reason.
 */
export function isValuationStale(
  valuedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = valuationAgeDays(valuedAt, now);
  return age === null || age > VALUATION_STALE_DAYS;
}
