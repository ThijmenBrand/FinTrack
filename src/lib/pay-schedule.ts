import { db } from "@/db";
import { recurringTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { frequencyDates } from "@/lib/recurring";

export type PayFrequency = "weekly" | "biweekly" | "monthly" | "yearly";

export interface PaySchedule {
  frequency: PayFrequency;
  startDate: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
}

const FALLBACK: PaySchedule = {
  frequency: "monthly",
  startDate: "2024-01-25",
  dayOfWeek: null,
  dayOfMonth: 25,
  monthOfYear: null,
};

/**
 * Pick a pay schedule for a user. Looks for an active recurring income
 * transaction; falls back to "monthly on the 25th" so spike math still
 * produces sensible numbers when no recurring income is configured.
 */
export async function getPaySchedule(userId: string): Promise<PaySchedule> {
  const rows = await db
    .select({
      amount: recurringTransactions.amount,
      frequency: recurringTransactions.frequency,
      dayOfWeek: recurringTransactions.dayOfWeek,
      dayOfMonth: recurringTransactions.dayOfMonth,
      monthOfYear: recurringTransactions.monthOfYear,
      startDate: recurringTransactions.startDate,
    })
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.type, "income"),
        eq(recurringTransactions.isActive, true)
      )
    );

  if (rows.length === 0) return FALLBACK;

  // Prefer the largest-amount recurring income (likely the primary salary).
  const best = rows.reduce((a, b) =>
    Math.abs(a.amount) >= Math.abs(b.amount) ? a : b
  );

  return {
    frequency: best.frequency as PayFrequency,
    startDate: best.startDate,
    dayOfWeek: best.dayOfWeek,
    dayOfMonth: best.dayOfMonth,
    monthOfYear: best.monthOfYear,
  };
}

/**
 * Generate the list of payday dates (YYYY-MM-DD) on or after `from` and
 * strictly before `to`. The window is half-open so a payday landing exactly
 * on the spike's target date does not count toward "paydays remaining".
 */
export function paydaysBetween(
  schedule: PaySchedule,
  from: Date,
  to: Date
): string[] {
  if (to <= from) return [];

  return frequencyDates(
    schedule.frequency,
    schedule.startDate,
    schedule.dayOfWeek,
    schedule.dayOfMonth,
    schedule.monthOfYear,
    from,
    to,
    false, // half-open: exclude a payday landing exactly on `to`
    false // window assumes from >= start; don't clamp weekly/monthly to start
  );
}
