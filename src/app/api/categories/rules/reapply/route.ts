import { NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, transactions } from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

/**
 * POST /api/categories/rules/reapply
 * Clears rule-applied transaction categories, then reapplies every active rule
 * in order. Manually categorized transactions (categorySource = 'manual') are
 * preserved — the current ruleset is the source of truth only for rule-applied
 * categories.
 */
export async function POST() {
  try {
    const userId = await getUserId();

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
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, userId)));

    // Step 3: Apply each rule in order
    let totalApplied = 0;
    const ruleResults: { pattern: string; matchType: string; applied: number }[] = [];

    for (const rule of allRules) {
      const applied = await applyRule(rule.pattern, rule.categoryId, rule.matchType, userId);
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

    return NextResponse.json({
      success: true,
      rulesApplied: allRules.length,
      transactionsCategorized: totalApplied,
      totalTransactions: total,
      uncategorized,
    });
  } catch (error) {
    console.error("Failed to reapply rules:", error);
    return NextResponse.json(
      { error: "Failed to reapply rules" },
      { status: 500 }
    );
  }
}

async function applyRule(
  pattern: string,
  categoryId: string,
  matchType: string,
  userId: string
): Promise<number> {
  let sqlPattern: string;
  switch (matchType) {
    case "exact":
      sqlPattern = pattern;
      break;
    case "starts_with":
      sqlPattern = `${pattern}%`;
      break;
    case "contains":
    default:
      sqlPattern = `%${pattern}%`;
      break;
  }

  const condition =
    matchType === "exact"
      ? sql`LOWER(${transactions.description}) = LOWER(${pattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId}`
      : sql`LOWER(${transactions.description}) LIKE LOWER(${sqlPattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId}`;

  const result = await db
    .update(transactions)
    .set({ categoryId, categorySource: "rule" })
    .where(condition);

  return result.rowsAffected;
}
