/** Local-midnight Date for a "YYYY-MM-DD" key (a bare ISO date parses as UTC). */
function parseDay(day: string): Date {
  return new Date(`${day.slice(0, 10)}T00:00:00`);
}

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Section heading for a day in the mobile transaction list, the way banking
 * apps group a statement: "Today", "Yesterday", then the weekday and date —
 * with the year only once it isn't this year.
 */
export function formatDayHeading(
  day: string,
  now: Date,
  intlLocale: string,
  labels: { today: string; yesterday: string },
): string {
  const key = day.slice(0, 10);
  if (key === dayKey(now)) return labels.today;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday)) return labels.yesterday;

  const date = parseDay(key);
  const label = new Intl.DateTimeFormat(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
