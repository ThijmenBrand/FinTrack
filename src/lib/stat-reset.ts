import { db } from "@/db";
import { statResets } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

/**
 * A statistics reset marks the day the user's financial life changed enough
 * that older spending should stop informing forward-looking maths. Only the
 * newest reset governs; earlier ones survive as markers on the charts.
 *
 * What a reset changes: backward-looking averages (budget averages,
 * auto-budget suggestions, the income-day suggestion) and vs-previous-period
 * comparisons. What it never changes: transactions, balances, and the charts
 * that plot actual history — those always show everything.
 */

export { clampFrom, isBeforeCutoff } from "@/lib/stat-reset-marks";

/** Every reset for a user, newest first. */
export function listStatResets(userId: string) {
  return db
    .select({
      id: statResets.id,
      date: statResets.date,
      note: statResets.note,
      createdAt: statResets.createdAt,
    })
    .from(statResets)
    .where(eq(statResets.userId, userId))
    .orderBy(desc(statResets.date), desc(statResets.createdAt));
}

/** The active cutoff (newest reset date), or null when the user has none. */
export async function getStatsCutoff(userId: string): Promise<string | null> {
  const [row] = await listStatResets(userId).limit(1);
  return row?.date ?? null;
}
