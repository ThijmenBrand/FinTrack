import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categoryRules, categories } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { validatePattern } from "@/lib/validation";
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

    // Look up target category to derive transaction type from category kind
    // (kind='reserved' → type='reserved'). Internal-transfer status is a
    // property of the transaction itself (set at import via IBAN matching),
    // not tied to a category — so users can categorize transfers freely
    // (e.g. label a savings transfer as "Saving") without changing the type.
    const [targetCategory] = categoryId
      ? await db
          .select({ kind: categories.kind })
          .from(categories)
          .where(eq(categories.id, categoryId))
      : [null];

    const isAssigningReserved = targetCategory?.kind === "reserved";

    // Update the transactions' category (and type if needed): assigning a
    // reserved-kind category forces type='reserved'; otherwise any currently
    // reserved transaction reverts to income/expense based on amount sign.
    await db
      .update(transactions)
      .set({
        categoryId: categoryId || null,
        categorySource: categoryId ? "manual" : null,
        type: isAssigningReserved
          ? "reserved"
          : sql`IIF(${transactions.type} = 'reserved', IIF(${transactions.amount} >= 0, 'income', 'expense'), ${transactions.type})`,
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
      const matchType = ruleMatchType || "contains";

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
        isReserved: isAssigningReserved,
      });
    }

    return NextResponse.json({
      success: true,
      ruleId,
      appliedCount,
    });
  }, "Failed to categorize transaction");
}
