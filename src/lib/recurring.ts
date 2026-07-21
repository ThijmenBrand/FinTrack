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
