/**
 * When the morning evaluation runs: once per local day, at the first scheduler
 * tick from 08:00 in the app's time zone (APP_TIMEZONE, default
 * Europe/Amsterdam — the app has no per-user zone yet).
 */
export const DAILY_RUN_HOUR = 8;
export const DAILY_RUN_SETTING = "notifications.daily_run";

export function appTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const tz = env.APP_TIMEZONE?.trim() || "Europe/Amsterdam";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "Europe/Amsterdam";
  }
}

/** Local date (YYYY-MM-DD) and hour of `now` in `timeZone`. */
export function localDateHour(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Today's local date when the morning run is due and hasn't happened yet, else null. */
export function dailyRunDue(now: Date, lastRun: string | null, timeZone: string): string | null {
  const { date, hour } = localDateHour(now, timeZone);
  if (hour < DAILY_RUN_HOUR || lastRun === date) return null;
  return date;
}
