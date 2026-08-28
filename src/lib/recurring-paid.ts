import { db } from "@/db";
import { transactions } from "@/db/schema";
import { and, inArray, max } from "drizzle-orm";
import { visibleTransactions } from "@/lib/account-access";

/**
 * Latest transaction date per recurring plan, for the plans passed in. Keyed by
 * plan id.
 *
 * Scoped with `visibleTransactions` rather than a plain user_id match: a plan
 * on a shared account has rows carrying the OWNER's user id, which a plain
 * match would miss — and an unscoped query is refused by the tenant guard.
 *
 * A plan whose payment already landed shouldn't keep showing that occurrence as
 * upcoming — see `isOccurrencePaid`.
 */
export async function lastPaidByPlan(
  planIds: string[],
  userId: string
): Promise<Map<string, string>> {
  if (planIds.length === 0) return new Map();
  const rows = await db
    .select({ planId: transactions.recurringTransactionId, lastPaid: max(transactions.date) })
    .from(transactions)
    .where(
      and(inArray(transactions.recurringTransactionId, planIds), visibleTransactions(userId))
    )
    .groupBy(transactions.recurringTransactionId);
  return new Map(
    rows.flatMap((r) => (r.planId && r.lastPaid ? [[r.planId, r.lastPaid] as const] : []))
  );
}
