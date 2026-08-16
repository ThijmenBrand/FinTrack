import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categoryRules, categories } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { validatePattern, isMatchType } from "@/lib/validation";
import { applyRuleToTransactions } from "@/lib/apply-rule";
import { writableTransactions } from "@/lib/account-access";

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

    // A category reference must live in its ROW's owner space — on a shared
    // account that's the account owner, not necessarily the caller. So a
    // category id resolves to an owner (categoryOwnerId), and only rows that
    // owner actually owns may be set to it in this same batch.
    let categoryOwnerId: string | null = null;
    if (categoryId) {
      const [targetCategory] = await db
        .select({ id: categories.id, userId: categories.userId })
        .from(categories)
        .where(eq(categories.id, categoryId));
      if (!targetCategory) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
      categoryOwnerId = targetCategory.userId;
    }

    // writableTransactions already excludes viewer-shared rows; ids the
    // caller can't write to (or, when setting a category, whose account owner
    // doesn't match the category's owner) are silently skipped — same
    // silent-partial-match convention the bulk update already had.
    const rowConditions = [inArray(transactions.id, ids), writableTransactions(userId)];
    if (categoryOwnerId) rowConditions.push(eq(transactions.userId, categoryOwnerId));

    await db
      .update(transactions)
      .set({
        categoryId: categoryId || null,
        categorySource: categoryId ? "manual" : null,
        modifiedBy: userId,
      })
      .where(and(...rowConditions));

    let ruleId: string | null = null;
    let appliedCount = 0;

    // Optionally create a categorization rule — rules live in the category
    // owner's space too, same as the category itself.
    if (createRule && rulePattern && categoryId && categoryOwnerId) {
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
        userId: categoryOwnerId,
        createdAt: new Date().toISOString(),
      });

      // Apply the rule to all matching uncategorized transactions (in the
      // category owner's space).
      appliedCount = await applyRuleToTransactions({
        pattern: cleanPattern,
        categoryId,
        matchType,
        userId: categoryOwnerId,
      });
    }

    return NextResponse.json({
      success: true,
      ruleId,
      appliedCount,
    });
  }, "Failed to categorize transaction");
}
