/**
 * "Which financial month does this date belong to?" in SQL.
 *
 * A date on or after the start day belongs to the window that opened in its
 * own calendar month; an earlier day belongs to the one that opened the month
 * before. The result is the `YYYY-MM` the window opened in, which is exactly
 * the (year, monthIndex) pair `financialSlotOf` produces — budget-ledger-db's
 * tests pin the two implementations to each other across the awkward dates.
 *
 * Grouping in SQL rather than bucketing rows in JS matters for pots, whose
 * net-spend floor has to be applied per month rather than per row.
 */

import { sql, type SQL } from "drizzle-orm";
import { transactions } from "@/db/schema";
import { clampStartDay } from "@/lib/financial-month";

/**
 * Bucket expression over `transactions.date`. `startDay` travels as a bound
 * parameter.
 *
 * Clamped the same way every JS path clamps it. Preferences already store the
 * day in 1–28, but the clamp is what keeps SQL and JS from disagreeing if an
 * unclamped value ever reaches here: SQLite's `-1 months` normalises overflow,
 * so a start day of 31 would push `2026-03-30` to `2026-03-02` and bucket it
 * into the wrong month while `financialSlotOf` clamped to 28 and did not.
 */
export function financialMonthBucketExpr(startDay: number): SQL {
  const date = transactions.date;
  const day = clampStartDay(startDay);
  return sql`strftime('%Y-%m', ${date}, CASE WHEN CAST(strftime('%d', ${date}) AS INTEGER) >= ${day} THEN '+0 days' ELSE '-1 months' END)`;
}

/** `YYYY-MM` bucket → the financial slot it names. */
export function parseBucket(bucket: string): { year: number; monthIndex: number } {
  return {
    year: Number(bucket.slice(0, 4)),
    monthIndex: Number(bucket.slice(5, 7)) - 1,
  };
}
