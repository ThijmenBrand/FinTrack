import { toIsoDate } from "@/lib/utils";

/**
 * Shared weekly/biweekly/monthly/yearly date walker. Emits ISO date strings
 * (YYYY-MM-DD) for every occurrence in the window bounded below by `from` and
 * above by `to`.
 *
 * - `inclusiveEnd`: include an occurrence landing exactly on `to` (recurring
 *   forecasts) vs. exclude it (half-open payday windows).
 * - `clampToStart`: anchor weekly/monthly/yearly walking to max(startDate, from)
 *   so nothing is emitted before startDate (recurring forecasts). When false,
 *   the walk is anchored to `from` (payday windows assume from >= start).
 *   Biweekly always anchors to max(startDate, from) to keep its mod-14 phase.
 */
function frequencyDates(
  frequency: string,
  startDate: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  monthOfYear: number | null,
  from: Date,
  to: Date,
  inclusiveEnd: boolean,
  clampToStart: boolean
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const beforeEnd = (d: Date) => (inclusiveEnd ? d <= to : d < to);

  const anchor = clampToStart
    ? new Date(Math.max(start.getTime(), from.getTime()))
    : new Date(from);
  anchor.setHours(0, 0, 0, 0);

  switch (frequency) {
    case "weekly": {
      const targetDow = dayOfWeek ?? start.getDay();
      const cur = new Date(anchor);
      while (cur.getDay() !== targetDow) cur.setDate(cur.getDate() + 1);
      while (beforeEnd(cur)) {
        dates.push(toIsoDate(cur));
        cur.setDate(cur.getDate() + 7);
      }
      break;
    }
    case "biweekly": {
      const cur = new Date(Math.max(start.getTime(), from.getTime()));
      cur.setHours(0, 0, 0, 0);
      const startMidnight = new Date(start).setHours(0, 0, 0, 0);
      const diffDays = Math.floor(
        (cur.getTime() - startMidnight) / (1000 * 60 * 60 * 24)
      );
      const remainder = ((diffDays % 14) + 14) % 14;
      if (remainder !== 0) cur.setDate(cur.getDate() + (14 - remainder));
      while (beforeEnd(cur)) {
        dates.push(toIsoDate(cur));
        cur.setDate(cur.getDate() + 14);
      }
      break;
    }
    case "monthly": {
      const dom = dayOfMonth ?? start.getDate();
      let year = anchor.getFullYear();
      let month = anchor.getMonth();
      if (anchor.getDate() > dom) month += 1;
      while (true) {
        if (month > 11) {
          month -= 12;
          year += 1;
        }
        const lastDay = new Date(year, month + 1, 0).getDate();
        const d = new Date(year, month, Math.min(dom, lastDay));
        if (!beforeEnd(d)) break;
        if (d >= from) dates.push(toIsoDate(d));
        month += 1;
      }
      break;
    }
    case "yearly": {
      const moy = (monthOfYear ?? start.getMonth() + 1) - 1;
      const dom = dayOfMonth ?? start.getDate();
      let year = anchor.getFullYear();
      while (true) {
        const lastDay = new Date(year, moy + 1, 0).getDate();
        const d = new Date(year, moy, Math.min(dom, lastDay));
        if (!beforeEnd(d)) break;
        if (d >= from) dates.push(toIsoDate(d));
        year += 1;
      }
      break;
    }
  }

  return dates;
}

/**
 * Generate all occurrences of a recurring transaction between two dates.
 * Returns ISO date strings (YYYY-MM-DD) within [forecastFrom, min(endDate, forecastTo)].
 */
export function generateOccurrences(
  frequency: string,
  startDate: string,
  endDate: string | null,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  monthOfYear: number | null,
  forecastFrom: Date,
  forecastTo: Date
): string[] {
  const end = endDate ? new Date(endDate) : forecastTo;
  const effectiveEnd = end < forecastTo ? end : forecastTo;
  return frequencyDates(
    frequency,
    startDate,
    dayOfWeek,
    dayOfMonth,
    monthOfYear,
    forecastFrom,
    effectiveEnd,
    true, // inclusive of effectiveEnd
    true // never emit before startDate
  );
}

export { frequencyDates };

/**
 * Normalise any frequency to what it costs per month, so plans on different
 * cadences can be summed and compared. Lives here (not month-money) because
 * the UI needs it client-side and month-money pulls in the db.
 */
export function toMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case "weekly":
      return Math.abs(amount) * 4.33;
    case "biweekly":
      return Math.abs(amount) * 2.17;
    case "monthly":
      return Math.abs(amount);
    case "yearly":
      return Math.abs(amount) / 12;
    default:
      return Math.abs(amount);
  }
}

/**
 * Inverse of `toMonthly`. A sub-line stores its money monthly; a linked
 * recurring row stores it per occurrence — linking the two means converting
 * both ways. `toMonthly` folds sign via `Math.abs`, so this returns a
 * positive per-occurrence figure too; the caller owns the sign convention of
 * the row it writes.
 */
export function fromMonthly(monthly: number, frequency: string): number {
  const value = Math.abs(monthly);
  switch (frequency) {
    case "weekly":
      return value / 4.33;
    case "biweekly":
      return value / 2.17;
    case "monthly":
      return value;
    case "yearly":
      return value * 12;
    default:
      return value;
  }
}

/**
 * Calculate the next occurrence date for a recurring transaction.
 */
export function getNextOccurrence(
  frequency: string,
  startDate: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  monthOfYear: number | null,
  refDate: Date = new Date()
): string {
  const ref = new Date(refDate);
  ref.setHours(0, 0, 0, 0);

  switch (frequency) {
    case "weekly": {
      const targetDow = dayOfWeek ?? new Date(startDate).getDay();
      const current = ref.getDay();
      let daysAhead = targetDow - current;
      if (daysAhead <= 0) daysAhead += 7;
      const next = new Date(ref);
      next.setDate(next.getDate() + daysAhead);
      return toIsoDate(next);
    }
    case "biweekly": {
      const start = new Date(startDate);
      const diffMs = ref.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const cycleDay = ((diffDays % 14) + 14) % 14;
      const daysUntil = cycleDay === 0 ? 14 : 14 - cycleDay;
      const next = new Date(ref);
      next.setDate(next.getDate() + daysUntil);
      return toIsoDate(next);
    }
    case "monthly": {
      const dom = dayOfMonth ?? new Date(startDate).getDate();
      let year = ref.getFullYear();
      let month = ref.getMonth();
      // If we're past this month's day, go to next month
      if (ref.getDate() >= dom) {
        month += 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
      }
      // Clamp to valid day (e.g., Feb 31 -> Feb 28)
      const lastDay = new Date(year, month + 1, 0).getDate();
      const actualDay = Math.min(dom, lastDay);
      return toIsoDate(new Date(year, month, actualDay));
    }
    case "yearly": {
      const moy = (monthOfYear ?? new Date(startDate).getMonth() + 1) - 1; // 0-indexed
      const dom2 = dayOfMonth ?? new Date(startDate).getDate();
      let year = ref.getFullYear();
      const thisYearDate = new Date(year, moy, Math.min(dom2, new Date(year, moy + 1, 0).getDate()));
      if (ref >= thisYearDate) {
        year += 1;
      }
      const lastDay = new Date(year, moy + 1, 0).getDate();
      return toIsoDate(new Date(year, moy, Math.min(dom2, lastDay)));
    }
    default:
      return startDate;
  }
}
