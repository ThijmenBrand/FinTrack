import { NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, transactions } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

/**
 * POST /api/categories/rules/reapply
 * Clears all transaction categories, then reapplies every active rule in order.
 * This ensures the current ruleset is the single source of truth.
 */
export async function POST() {
  try {
    // Step 1: Clear all category assignments
    await db
      .update(transactions)
      .set({ categoryId: null })
      .where(sql`${transactions.categoryId} IS NOT NULL`);

    // Step 2: Fetch all active rules
    const allRules = await db
      .select()
      .from(categoryRules)
      .where(eq(categoryRules.isActive, true));

    // Step 3: Apply each rule in order
    let totalApplied = 0;
    const ruleResults: { pattern: string; matchType: string; applied: number }[] = [];

    for (const rule of allRules) {
      const applied = await applyRule(rule.pattern, rule.categoryId, rule.matchType);
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
      .where(sql`${transactions.categoryId} IS NULL`);

    const uncategorized = uncategorizedResult[0]?.count || 0;

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions);

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
  matchType: string
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
      ? sql`LOWER(${transactions.description}) = LOWER(${pattern}) AND ${transactions.categoryId} IS NULL`
      : sql`LOWER(${transactions.description}) LIKE LOWER(${sqlPattern}) AND ${transactions.categoryId} IS NULL`;

  const result = await db
    .update(transactions)
    .set({ categoryId })
    .where(condition);

  return result.rowsAffected;
}
