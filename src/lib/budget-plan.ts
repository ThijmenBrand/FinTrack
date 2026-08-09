import { db } from "@/db";
import { accounts, budgetPlans, transactions } from "@/db/schema";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

export interface ResolvedBudgetPlan {
  id: string;
  name: string;
  isMain: boolean;
  accountIds: string[];
}

/**
 * The user's plan by id — or their main plan when `budgetId` is null. Returns
 * null when the user has no matching plan (unknown id, or a brand-new user the
 * 0009 backfill had nothing to create for).
 */
export async function resolveBudgetPlan(
  userId: string,
  budgetId?: string | null,
): Promise<ResolvedBudgetPlan | null> {
  const [plan] = await db
    .select()
    .from(budgetPlans)
    .where(
      and(
        eq(budgetPlans.userId, userId),
        budgetId ? eq(budgetPlans.id, budgetId) : eq(budgetPlans.isMain, true),
      ),
    )
    .limit(1);
  if (!plan) return null;

  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.budgetId, plan.id)));

  return {
    id: plan.id,
    name: plan.name,
    isMain: plan.isMain,
    accountIds: rows.map((r) => r.id),
  };
}

/**
 * WHERE fragment restricting transactions to a set of accounts. An empty set
 * matches nothing — a plan with no accounts has no spending, it doesn't fall
 * back to "all accounts". Undefined means no restriction.
 */
export function accountScopeFilter(accountIds: string[] | undefined): SQL | undefined {
  if (accountIds === undefined) return undefined;
  if (accountIds.length === 0) return sql`1=0`;
  return inArray(transactions.accountId, accountIds);
}
