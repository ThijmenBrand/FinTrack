import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categoryRules } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// PUT /api/transactions/categorize — categorize a transaction (and optionally create a rule)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionId, categoryId, createRule, rulePattern, ruleMatchType } = body;

    if (!transactionId) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 }
      );
    }

    // Update the transaction's category
    await db
      .update(transactions)
      .set({ categoryId: categoryId || null })
      .where(eq(transactions.id, transactionId));

    let ruleId: string | null = null;
    let appliedCount = 0;

    // Optionally create a categorization rule
    if (createRule && rulePattern && categoryId) {
      ruleId = crypto.randomUUID();
      const matchType = ruleMatchType || "contains";

      await db.insert(categoryRules).values({
        id: ruleId,
        pattern: rulePattern,
        categoryId,
        matchType,
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      // Apply the rule to all matching uncategorized transactions
      let sqlPattern: string;
      switch (matchType) {
        case "exact":
          sqlPattern = rulePattern;
          break;
        case "starts_with":
          sqlPattern = `${rulePattern}%`;
          break;
        case "contains":
        default:
          sqlPattern = `%${rulePattern}%`;
          break;
      }

      const condition =
        matchType === "exact"
          ? sql`LOWER(${transactions.description}) = LOWER(${rulePattern}) AND ${transactions.categoryId} IS NULL`
          : sql`LOWER(${transactions.description}) LIKE LOWER(${sqlPattern}) AND ${transactions.categoryId} IS NULL`;

      const result = await db
        .update(transactions)
        .set({ categoryId })
        .where(condition);

      appliedCount = result.rowsAffected;
    }

    return NextResponse.json({
      success: true,
      ruleId,
      appliedCount,
    });
  } catch (error) {
    console.error("Failed to categorize transaction:", error);
    return NextResponse.json(
      { error: "Failed to categorize transaction" },
      { status: 500 }
    );
  }
}
