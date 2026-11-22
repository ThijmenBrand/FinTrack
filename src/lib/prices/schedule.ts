/**
 * When a close exists to be fetched, and therefore when a call is worth making.
 *
 * Pure date arithmetic, kept apart from the fetching so the rules that save
 * the most budget are the easiest ones to test. Every call avoided here is a
 * call the 20-a-day plan still has.
 */

/** Saturday and Sunday print no close anywhere this app cares about. */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/**
 * European closes land around 17:30 CET. Asking before then returns the
 * previous day's row and spends a call to learn nothing, so the day only
 * becomes askable once it has actually closed.
 */
const CLOSE_HOUR_UTC = 17;

/**
 * The most recent date that has a published close.
 *
 * Weekends step back to Friday. Today counts only once the market has closed;
 * before that the answer is the previous trading day, which the refresh will
 * usually already hold — and so it makes no call at all.
 *
 * Holidays are not modelled: no provider-free way to know them, and the cost
 * of being wrong is one call that returns nothing, bounded by the once-a-day
 * schedule. Guessing a holiday calendar wrong would be worse — it would skip
 * a day that did trade.
 */
export function lastClosedTradingDay(now: Date): string {
  const d = new Date(now);
  if (!isWeekend(d) && d.getUTCHours() < CLOSE_HOUR_UTC) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() - 1);
  return toIso(d);
}

/**
 * The date to ask from, given what is already stored — or null when the stored
 * history already reaches the last close and the call would be wasted.
 *
 * This is the single most important budget decision in the system: an
 * instrument priced through Friday, asked again on Saturday, Sunday and before
 * Monday's close, costs nothing on all three.
 */
/**
 * Note on `backfillYears`: the provider clamps the range to what the plan
 * allows and says so in a `warning` field on the last row — the free plan
 * returns one year however much is asked for. Asking for more costs nothing
 * extra (it is the same single call), so the ceiling stays generous and a
 * paid plan starts returning the rest without a code change.
 */
export function nextFetchFrom(
  latestStored: string | null,
  now: Date,
  backfillYears = 5,
): string | null {
  const target = lastClosedTradingDay(now);
  if (!latestStored) {
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - backfillYears);
    return toIso(start);
  }
  if (latestStored >= target) return null;
  return addDays(latestStored, 1);
}
