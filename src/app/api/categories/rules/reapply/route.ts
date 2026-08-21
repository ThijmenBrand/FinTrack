import { NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, transactions } from "@/db/schema";
import { sql, eq, and, isNull } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { applyRuleToTransactions } from "@/lib/apply-rule";
import { applySplitRulesToExisting } from "@/lib/split-rules";
import { excludeSplitParents } from "@/lib/split-sql";

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
    // Split children are left alone: their category usually comes from the
    // split rule that created them (also stored as source 'rule'), and split
    // rules don't re-run on already-split transactions, so clearing here would
    // strand them uncategorized.
    await db
      .update(transactions)
      .set({ categoryId: null, categorySource: null })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.categorySource, "rule"),
          isNull(transactions.parentTransactionId)
        )
      );

    // Step 2: Fetch all active rules
    const allRules = await db
      .select({
        id: categoryRules.id,
        pattern: categoryRules.pattern,
        categoryId: categoryRules.categoryId,
        matchType: categoryRules.matchType,
        matchField: categoryRules.matchField,
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
        matchField: rule.matchField,
        userId,
      });
      totalApplied += applied;
      ruleResults.push({
        pattern: rule.pattern,
        matchType: rule.matchType,
        applied,
      });
    }

    // Step 4: Split rules. resplit because this is the "Recalculate All"
    // button: rule-made splits are redone against the current rules, exactly
    // like rule-made categories were cleared and reapplied above. Splits the
    // user made by hand are left alone either way.
    const transactionsSplit = await applySplitRulesToExisting(userId, { resplit: true });

    // Step 5: Count remaining uncategorized
    const uncategorizedResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(
          sql`${transactions.categoryId} IS NULL`,
          // A split wrapper's category is cleared by design — its children carry
          // the categories, so it isn't "remaining uncategorized" work.
          excludeSplitParents(),
          eq(transactions.userId, userId),
        ),
      );

    const uncategorized = uncategorizedResult[0]?.count || 0;

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.userId, userId));

    const total = totalResult[0]?.count || 0;

    return NextResponse.json({
      success: true,
      rulesApplied: allRules.length,
      transactionsCategorized: totalApplied,
      transactionsSplit,
      totalTransactions: total,
      uncategorized,
    });
  }, "Failed to reapply rules");
}
