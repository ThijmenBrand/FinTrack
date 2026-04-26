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
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : forecastTo;
  const effectiveEnd = end < forecastTo ? end : forecastTo;

  const current = new Date(Math.max(start.getTime(), forecastFrom.getTime()));
  current.setHours(0, 0, 0, 0);

  switch (frequency) {
    case "weekly": {
      const targetDow = dayOfWeek ?? start.getDay();
      while (current.getDay() !== targetDow) {
        current.setDate(current.getDate() + 1);
      }
      while (current <= effectiveEnd) {
        dates.push(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 7);
      }
      break;
    }
    case "biweekly": {
      const diffMs = current.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const remainder = ((diffDays % 14) + 14) % 14;
      if (remainder !== 0) {
        current.setDate(current.getDate() + (14 - remainder));
      }
      while (current <= effectiveEnd) {
        dates.push(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 14);
      }
      break;
    }
    case "monthly": {
      const dom = dayOfMonth ?? start.getDate();
      let year = current.getFullYear();
      let month = current.getMonth();
      if (current.getDate() > dom) month += 1;
      while (true) {
        if (month > 11) {
          month -= 12;
          year += 1;
        }
        const lastDay = new Date(year, month + 1, 0).getDate();
        const d = new Date(year, month, Math.min(dom, lastDay));
        if (d > effectiveEnd) break;
        if (d >= forecastFrom) dates.push(d.toISOString().slice(0, 10));
        month += 1;
      }
      break;
    }
    case "yearly": {
      const moy = (monthOfYear ?? start.getMonth() + 1) - 1;
      const dom = dayOfMonth ?? start.getDate();
      let year = current.getFullYear();
      while (true) {
        const lastDay = new Date(year, moy + 1, 0).getDate();
        const d = new Date(year, moy, Math.min(dom, lastDay));
        if (d > effectiveEnd) break;
        if (d >= forecastFrom) dates.push(d.toISOString().slice(0, 10));
        year += 1;
      }
      break;
    }
  }

  return dates;
}
