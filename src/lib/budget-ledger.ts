/**
 * The carry-over maths behind yearly budgets. Pure — no database, no clock —
 * so the arithmetic can be tested on its own.
 *
 * A yearly allocation is one annual envelope per category. Each financial
 * month draws `target` from it (the allocation's monthly amount) plus whatever
 * the earlier months of the same year left behind:
 *
 *     allowance(i)   = target(i) + rolloverIn(i)
 *     rolloverOut(i) = allowance(i) − spent(i)
 *     rolloverIn(i+1) = rolloverOut(i)
 *
 * Carry-over is symmetric: an overspent month hands the next month a negative
 * rollover, because there is only one pot and the money really is gone. The
 * chain resets to zero at the start of every financial year — last year's
 * leftover and last year's debt both die there.
 *
 * Closed months keep the target they closed with. Raising an allocation in
 * July gives the raise to August–December only; January's allowance stays what
 * January actually had. A late correction to an old transaction changes that
 * month's `spent` and re-cascades every rollover after it, which is why
 * `cascade` always recomputes the whole tail rather than patching one row.
 */

import type { FinancialMonthSlot } from "@/lib/financial-year";

/** Money is stored as floats; anything under half a cent is noise. */
export const MONEY_EPSILON = 0.005;

export interface LedgerMonthInput extends FinancialMonthSlot {
  /** True once the month has fully elapsed — its target stops following the allocation. */
  closed: boolean;
  /** The target this month closed with, if it has one on record already. */
  frozenTarget?: number | null;
  spent: number;
}

export interface LedgerMonth extends FinancialMonthSlot {
  closed: boolean;
  target: number;
  spent: number;
  rolloverIn: number;
  rolloverOut: number;
  /** What this month may actually spend: its own target plus carry-over. */
  allowance: number;
}

export interface CascadeOptions {
  /**
   * The allocation's current monthly amount. Open months use it; closed months
   * keep whatever they froze.
   */
  monthlyAmount: number;
  /**
   * First month the envelope covers, 0–11. Months before it get no target and
   * no carry-over: a category added in July is budgeted for July onward, and a
   * plan switched to yearly in July starts its carry-over there.
   */
  startMonthIndex?: number;
}

/**
 * Run the rollover chain across a financial year.
 *
 * Months before `startMonthIndex` come back with a zero target and zero
 * carry-over — they are outside the envelope, not a part of it that happened
 * to be empty.
 */
export function cascade(
  months: LedgerMonthInput[],
  { monthlyAmount, startMonthIndex = 0 }: CascadeOptions,
): LedgerMonth[] {
  const out: LedgerMonth[] = [];
  let carry = 0;

  for (const month of months) {
    if (month.monthIndex < startMonthIndex) {
      out.push({
        monthIndex: month.monthIndex,
        from: month.from,
        to: month.to,
        closed: month.closed,
        target: 0,
        spent: month.spent,
        rolloverIn: 0,
        rolloverOut: 0,
        allowance: 0,
      });
      continue;
    }

    // A closed month keeps the target it closed with. `frozenTarget` is only
    // trusted on closed months — on an open one it is a stale snapshot of an
    // allocation the user may have just changed.
    const target =
      month.closed && month.frozenTarget != null
        ? month.frozenTarget
        : monthlyAmount;
    const allowance = target + carry;
    const rolloverOut = allowance - month.spent;

    out.push({
      monthIndex: month.monthIndex,
      from: month.from,
      to: month.to,
      closed: month.closed,
      target,
      spent: month.spent,
      rolloverIn: carry,
      rolloverOut,
      allowance,
    });
    carry = rolloverOut;
  }

  return out;
}

/**
 * The size of the annual envelope: every month's target added up. Not simply
 * `monthlyAmount × 12` — a category added in July is prorated to the months it
 * covers, and a mid-year change leaves closed months at their old target.
 */
export function annualPot(months: LedgerMonth[]): number {
  return months.reduce((sum, m) => sum + m.target, 0);
}

/** What a category has spent across the whole financial year so far. */
export function yearSpent(months: LedgerMonth[]): number {
  return months.reduce((sum, m) => sum + m.spent, 0);
}

export type EnvelopeStatus = "ok" | "month-over" | "year-over";

/**
 * How a yearly category is doing, in the two ways that can go wrong: the
 * annual pot is spent (red — real, structural), or this month has gone past
 * its carry-over-adjusted allowance while the year still has room (amber —
 * a pace warning, recoverable by underspending later).
 */
export function envelopeStatus(
  months: LedgerMonth[],
  currentMonthIndex: number,
): EnvelopeStatus {
  if (yearSpent(months) > annualPot(months) + MONEY_EPSILON) return "year-over";
  const current = months.find((m) => m.monthIndex === currentMonthIndex);
  if (current && current.spent > current.allowance + MONEY_EPSILON) {
    return "month-over";
  }
  return "ok";
}

/**
 * Rebuild the whole year from a category's monthly spend totals — the entry
 * point the read path goes through.
 */
export function buildYear(options: {
  slots: FinancialMonthSlot[];
  spentByMonth: Map<number, number>;
  frozenTargets?: Map<number, number>;
  closedThrough: number;
  monthlyAmount: number;
  startMonthIndex?: number;
}): LedgerMonth[] {
  const {
    slots,
    spentByMonth,
    frozenTargets,
    closedThrough,
    monthlyAmount,
    startMonthIndex = 0,
  } = options;

  const inputs: LedgerMonthInput[] = slots.map((slot) => ({
    ...slot,
    closed: slot.monthIndex < closedThrough,
    frozenTarget: frozenTargets?.get(slot.monthIndex) ?? null,
    spent: spentByMonth.get(slot.monthIndex) ?? 0,
  }));

  return cascade(inputs, { monthlyAmount, startMonthIndex });
}
