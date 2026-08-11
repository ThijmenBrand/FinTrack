import { NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, transactions } from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { touchAllLedgers } from "@/lib/budget-jobs";
import { applyRuleToTransactions } from "@/lib/apply-rule";

/**
 * POST /api/categories/rules/reapply
 * Clears rule-applied transaction categories, then reapplies every active rule
 * in order. Manually categorized transactions (categorySource = 'manual') are
 * preserved — the current ruleset is the source of truth only for rule-applied
 * categories.
 */
export async function POST() {
  return withUser(async (userId) => {
    // Step 1: Clear only rule-applied category assignments. Manual ones survive.
    await db
      .update(transactions)
      .set({ categoryId: null, categorySource: null })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.categorySource, "rule")
        )
      );

    // Step 2: Fetch all active rules
    const allRules = await db
      .select({
        id: categoryRules.id,
        pattern: categoryRules.pattern,
        categoryId: categoryRules.categoryId,
        matchType: categoryRules.matchType,
      })
      .from(categoryRules)
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, userId)));

    // Step 3: Apply each rule in order
    let totalApplied = 0;
    const ruleResults: { pattern: string; matchType: string; applied: number }[] = [];

    for (const rule of allRules) {
      const applied = await applyRuleToTransactions({
        pattern: rule.pattern,
        categoryId: rule.categoryId,
        matchType: rule.matchType,
        userId,
      });
      totalApplied += applied;
      ruleResults.push({
        pattern: rule.pattern,
        matchType: rule.matchType,
        applied,
      });
    }

    // Step 4: Count remaining uncategorized
    const uncategorizedResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(sql`${transactions.categoryId} IS NULL`, eq(transactions.userId, userId)));

    const uncategorized = uncategorizedResult[0]?.count || 0;

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.userId, userId));

    const total = totalResult[0]?.count || 0;

    // A rules sweep can recategorise years of history at once.
    await touchAllLedgers(userId);

    return NextResponse.json({
      success: true,
      rulesApplied: allRules.length,
      transactionsCategorized: totalApplied,
      totalTransactions: total,
      uncategorized,
    });
  }, "Failed to reapply rules");
}
