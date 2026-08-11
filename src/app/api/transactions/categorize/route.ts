import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categoryRules, categories } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { touchAllLedgers } from "@/lib/budget-jobs";
import { validatePattern, isMatchType } from "@/lib/validation";
import { applyRuleToTransactions } from "@/lib/apply-rule";

// PUT /api/transactions/categorize — categorize one or more transactions
// (and optionally create a rule). Pass `transactionId` for a single one or
// `transactionIds` for a bulk update.
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { transactionId, transactionIds, categoryId, createRule, rulePattern, ruleMatchType } = body;

    const ids: string[] = Array.isArray(transactionIds)
      ? transactionIds.filter((id): id is string => typeof id === "string")
      : transactionId
        ? [transactionId]
        : [];

    if (ids.length === 0 || ids.length > 500) {
      return NextResponse.json(
        { error: "Provide between 1 and 500 transaction IDs" },
        { status: 400 }
      );
    }

    const [targetCategory] = categoryId
      ? await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      : [null];

    if (categoryId && !targetCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    await db
      .update(transactions)
      .set({
        categoryId: categoryId || null,
        categorySource: categoryId ? "manual" : null,
      })
      .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId)));

    let ruleId: string | null = null;
    let appliedCount = 0;

    // Optionally create a categorization rule
    if (createRule && rulePattern && categoryId) {
      const validated = validatePattern(rulePattern);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      const cleanPattern = validated.value;

      ruleId = crypto.randomUUID();
      const matchType = isMatchType(ruleMatchType) ? ruleMatchType : "contains";

      await db.insert(categoryRules).values({
        id: ruleId,
        pattern: cleanPattern,
        categoryId,
        matchType,
        isActive: true,
        userId,
        createdAt: new Date().toISOString(),
      });

      // Apply the rule to all matching uncategorized transactions
      appliedCount = await applyRuleToTransactions({
        pattern: cleanPattern,
        categoryId,
        matchType,
        userId,
      });
    }

    // Moving spend between categories reshapes the yearly envelopes.
    await touchAllLedgers(userId);

    return NextResponse.json({
      success: true,
      ruleId,
      appliedCount,
    });
  }, "Failed to categorize transaction");
}
