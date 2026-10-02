import { db } from "@/db";
import { recurringTransactions, transactions } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { rowMatchesPlan } from "@/lib/recurring-match";

// Kept well under SQLite's bound-parameter limit.
const CHUNK = 500;

/**
 * Link every not-yet-linked row on the plan's account that the plan claims
 * (`rowMatchesPlan`): run when a plan is created, and whenever it learns or
 * changes its rule, so history already in the database catches up with what a
 * fresh import would have linked. Returns the ids of the bank rows it linked,
 * so a learned rule can be undone exactly.
 *
 * Rows already linked — to this plan or any other — are never touched, so a
 * link the user made by hand stays; a row the user unlinked from this plan by
 * hand carries `recurringExcludedPlanId` and stays unlinked. Only bank rows
 * (no parent) are matched; split slices then follow their parent, the same
 * inheritance applySplit gives them.
 */
export async function linkMatchingTransactions(planId: string, ownerId: string): Promise<string[]> {
  const [plan] = await db
    .select({
      id: recurringTransactions.id,
      accountId: recurringTransactions.accountId,
      description: recurringTransactions.description,
      amount: recurringTransactions.amount,
      type: recurringTransactions.type,
      isActive: recurringTransactions.isActive,
      matchPattern: recurringTransactions.matchPattern,
      matchField: recurringTransactions.matchField,
      matchDescriptionPattern: recurringTransactions.matchDescriptionPattern,
    })
    .from(recurringTransactions)
    .where(and(eq(recurringTransactions.id, planId), eq(recurringTransactions.userId, ownerId)))
    .limit(1);
  if (!plan) return [];

  const candidates = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amount: transactions.amount,
      name: transactions.name,
      description: transactions.description,
      recurringExcludedPlanId: transactions.recurringExcludedPlanId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, ownerId),
        eq(transactions.accountId, plan.accountId),
        eq(transactions.type, plan.type),
        isNull(transactions.recurringTransactionId),
        isNull(transactions.parentTransactionId),
      ),
    );

  const ids = candidates.filter((row) => rowMatchesPlan(plan, row)).map((row) => row.id);
  if (ids.length === 0) return [];

  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      await tx
        .update(transactions)
        .set({ recurringTransactionId: plan.id })
        .where(
          and(
            eq(transactions.userId, ownerId),
            inArray(transactions.id, chunk),
            isNull(transactions.recurringTransactionId),
          ),
        );
      await tx
        .update(transactions)
        .set({ recurringTransactionId: plan.id })
        .where(
          and(
            eq(transactions.userId, ownerId),
            inArray(transactions.parentTransactionId, chunk),
            isNull(transactions.recurringTransactionId),
          ),
        );
    }
  });
  return ids;
}
