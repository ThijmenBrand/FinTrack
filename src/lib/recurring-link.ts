import { db } from "@/db";
import { recurringTransactions, transactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { logDataEvent } from "@/lib/audit";
import { learnMatchRule } from "@/lib/recurring-match";
import { linkMatchingTransactions } from "@/lib/recurring-backfill";

/** The row being (un)linked, as read by the caller. */
export interface LinkableRow {
  id: string;
  accountId: string;
  name: string | null;
  description: string;
  recurringTransactionId: string | null;
  recurringExcludedPlanId: string | null;
}

/** The plan it is linked to — resolved in the owner's space by the caller. */
export interface LinkablePlan {
  id: string;
  accountId: string;
  matchPattern: string | null;
}

export interface LinkResult {
  learnedPattern: string | null;
  alsoLinkedIds: string[];
}

/**
 * Link one row to a plan by hand, or unlink it (`plan` null). Shared by the
 * recurring link endpoint and the categorize endpoint — filing a row under a
 * plan's sub-category IS linking it — so the two can never disagree.
 *
 * An unlink is remembered (`recurringExcludedPlanId`), so automatic matching
 * never hands the row back to that plan; a link forgets it again.
 *
 * The first row linked to a plan by hand teaches it: the plan learns a match
 * rule from that row (see learnMatchRule) and every matching row in its
 * history is linked right away. The result names the rule and the rows it
 * linked, so the client can offer to undo exactly that.
 */
export async function setRecurringLink({
  actorId,
  ownerId,
  row,
  plan,
}: {
  actorId: string;
  ownerId: string;
  row: LinkableRow;
  plan: LinkablePlan | null;
}): Promise<LinkResult> {
  await db
    .update(transactions)
    .set({
      recurringTransactionId: plan?.id ?? null,
      recurringExcludedPlanId: plan
        ? null
        : (row.recurringTransactionId ?? row.recurringExcludedPlanId),
      modifiedBy: actorId,
    })
    .where(and(eq(transactions.id, row.id), eq(transactions.userId, ownerId)));

  logDataEvent({
    userId: actorId,
    action: plan ? "transaction_link_recurring" : "transaction_unlink_recurring",
    targetId: row.id,
    targetType: "transaction",
    details: {
      recurringTransactionId: plan?.id ?? null,
      ...(ownerId !== actorId ? { accountOwnerId: ownerId } : {}),
    },
  });

  // Only a row on the plan's own account can teach it — the rule only ever
  // matches there (see recurring-match.ts).
  if (!plan || plan.matchPattern || plan.accountId !== row.accountId) {
    return { learnedPattern: null, alsoLinkedIds: [] };
  }
  const rule = learnMatchRule(row);
  if (!rule) return { learnedPattern: null, alsoLinkedIds: [] };
  await db
    .update(recurringTransactions)
    .set(rule)
    .where(and(eq(recurringTransactions.id, plan.id), eq(recurringTransactions.userId, ownerId)));
  return {
    learnedPattern: rule.matchPattern,
    alsoLinkedIds: await linkMatchingTransactions(plan.id, ownerId),
  };
}
