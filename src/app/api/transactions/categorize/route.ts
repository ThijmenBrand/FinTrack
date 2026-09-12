import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactions, categoryRules, categories } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { validatePattern, isMatchType, isMatchField } from "@/lib/validation";
import { applyRuleToTransactions } from "@/lib/apply-rule";
import { subLineCategories } from "@/lib/budget-sub-lines";
import { writableTransactions } from "@/lib/account-access";

// PUT /api/transactions/categorize — categorize one or more transactions
// (and optionally create a rule). Pass `transactionId` for a single one or
// `transactionIds` for a bulk update.
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const {
      transactionId,
      transactionIds,
      categoryId,
      subLineId,
      createRule,
      rulePattern,
      ruleMatchType,
      ruleMatchField,
    } = body;

    const ids: string[] = Array.isArray(transactionIds)
      ? transactionIds.filter((id): id is string => typeof id === "string")
      : transactionId
        ? [transactionId]
        : [];

    if (ids.length === 0 || ids.length > 500) {
      return apiError("api.transactionIdRange", 400);
    }

    // A split parent is a pure wrapper — only its (already-normal) children
    // carry a category. Reject the whole batch rather than silently skip, so
    // the caller sees why nothing changed for that row.
    // Scoped by writableTransactions, the same gate the update below uses: a
    // wrapper the caller could not have categorized anyway is not their
    // problem, and the tenant guard requires the statement to name user_id.
    const [splitParent] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          inArray(transactions.id, ids),
          eq(transactions.isSplitParent, true),
          writableTransactions(userId),
        ),
      )
      .limit(1);
    if (splitParent) {
      return apiError("api.splitParentAction", 400);
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
        return apiError("api.categoryNotFound", 404);
      }
      categoryOwnerId = targetCategory.userId;
    }

    // A sub-line only ever narrows the category being set, so it has to plan
    // for exactly that category in exactly that owner's space. Anything else —
    // another category's line, someone else's line, or one sent while the
    // category is being cleared — is rejected rather than quietly dropped.
    let resolvedSubLineId: string | null = null;
    if (subLineId) {
      if (typeof subLineId !== "string" || !categoryOwnerId) {
        return apiError("api.subCategoryWrongCategory", 400);
      }
      const ownerSubLines = await subLineCategories(db, categoryOwnerId);
      if (ownerSubLines.get(subLineId) !== categoryId) {
        return apiError("api.subCategoryWrongCategory", 400);
      }
      resolvedSubLineId = subLineId;
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
        // Written on every categorization, never left behind: a row moved to
        // another category cannot keep the old one's sub-line.
        subLineId: resolvedSubLineId,
        // Any manual (re)categorization retires the deleted-category label.
        categoryLabel: null,
        modifiedBy: userId,
      })
      .where(and(...rowConditions));

    let ruleId: string | null = null;
    let appliedCount = 0;

    // Optionally create a categorization rule. Unlike the update above, a rule
    // is per-owner CONFIG: applyRuleToTransactions matches on user_id alone, so
    // it would reach every account of that owner — including ones never shared.
    // Only the owner may create one; for anyone else the flag is silently
    // skipped, same convention as the ids the update above drops.
    if (createRule && rulePattern && categoryId && categoryOwnerId === userId) {
      const validated = validatePattern(rulePattern);
      if (!validated.ok) {
        return apiError(validated.error, 400, validated.vars);
      }
      const cleanPattern = validated.value;

      ruleId = crypto.randomUUID();
      const matchType = isMatchType(ruleMatchType) ? ruleMatchType : "contains";
      const matchField = isMatchField(ruleMatchField) ? ruleMatchField : "both";

      await db.insert(categoryRules).values({
        id: ruleId,
        pattern: cleanPattern,
        categoryId,
        matchType,
        matchField,
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
        matchField,
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
