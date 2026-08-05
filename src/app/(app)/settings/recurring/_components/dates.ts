// Every date on this page is a plain YYYY-MM-DD string from the API. Parsing
// those with `new Date(iso)` reads them as UTC midnight, which renders as the
// previous day for anyone west of UTC — so slice the parts out by hand and
// build a local date instead.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** "31 aug" — the compact form used in dense rows. */
export function formatDayMonth(iso: string): string {
  const [, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Whole days from today. Negative for the past, 0 for today. */
export function daysUntil(iso: string): number {
  const [y, m, d] = parts(iso);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((then - today) / 86_400_000);
}

/**
 * A short "when" hint next to a date. Only worth showing inside the next
 * fortnight — past that, the date itself is the clearer answer.
 */
export function relativeDay(iso: string): string | null {
  const days = daysUntil(iso);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 14) return `in ${days} days`;
  return null;
}

/** Last day of a YYYY-MM month, as YYYY-MM-DD — where a month's end balance lands. */
export function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
