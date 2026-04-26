import { db } from "@/db";
import { recurringTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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

  const start = new Date(schedule.startDate);
  const dates: string[] = [];

  switch (schedule.frequency) {
    case "weekly": {
      const targetDow = schedule.dayOfWeek ?? start.getDay();
      const cur = new Date(from);
      cur.setHours(0, 0, 0, 0);
      while (cur.getDay() !== targetDow) cur.setDate(cur.getDate() + 1);
      while (cur < to) {
        dates.push(toIsoDate(cur));
        cur.setDate(cur.getDate() + 7);
      }
      break;
    }
    case "biweekly": {
      const cur = new Date(Math.max(start.getTime(), from.getTime()));
      cur.setHours(0, 0, 0, 0);
      const diffDays = Math.floor(
        (cur.getTime() - new Date(start).setHours(0, 0, 0, 0)) /
          (1000 * 60 * 60 * 24)
      );
      const remainder = ((diffDays % 14) + 14) % 14;
      if (remainder !== 0) cur.setDate(cur.getDate() + (14 - remainder));
      while (cur < to) {
        dates.push(toIsoDate(cur));
        cur.setDate(cur.getDate() + 14);
      }
      break;
    }
    case "monthly": {
      const dom = schedule.dayOfMonth ?? start.getDate();
      let year = from.getFullYear();
      let month = from.getMonth();
      if (from.getDate() > dom) month += 1;
      while (true) {
        if (month > 11) {
          month -= 12;
          year += 1;
        }
        const lastDay = new Date(year, month + 1, 0).getDate();
        const d = new Date(year, month, Math.min(dom, lastDay));
        if (d >= to) break;
        if (d >= from) dates.push(toIsoDate(d));
        month += 1;
      }
      break;
    }
    case "yearly": {
      const moy = (schedule.monthOfYear ?? start.getMonth() + 1) - 1;
      const dom = schedule.dayOfMonth ?? start.getDate();
      let year = from.getFullYear();
      while (true) {
        const lastDay = new Date(year, moy + 1, 0).getDate();
        const d = new Date(year, moy, Math.min(dom, lastDay));
        if (d >= to) break;
        if (d >= from) dates.push(toIsoDate(d));
        year += 1;
      }
      break;
    }
  }

  return dates;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
