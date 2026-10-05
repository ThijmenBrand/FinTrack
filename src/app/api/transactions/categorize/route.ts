import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import {
  transactions,
  categoryRules,
  categories,
  budgetSubLines,
  recurringTransactions,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { validatePattern, isMatchType, isMatchField } from "@/lib/validation";
import { applyRuleToTransactions } from "@/lib/apply-rule";
import { subLineCategories } from "@/lib/budget-sub-lines";
import { writableTransactions } from "@/lib/account-access";
import { setRecurringLink, type LinkablePlan } from "@/lib/recurring-link";

// PUT /api/transactions/categorize — categorize one or more transactions
// (and optionally create a rule). Pass `transactionId` for a single one or
// `transactionIds` for a bulk update.
//
// `recurringTransactionId` (single row only) files the row under a recurring
// plan's sub-category: a plan id links the row to that plan, null unlinks it,
// and leaving it out leaves the link alone — see setRecurringLink.
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
      recurringTransactionId,
    } = body;

    const ids: string[] = Array.isArray(transactionIds)
      ? transactionIds.filter((id): id is string => typeof id === "string")
      : transactionId
        ? [transactionId]
        : [];

    if (ids.length === 0 || ids.length > 500) {
      return apiError("api.transactionIdRange", 400);
    }
    // A link teaches its plan from the one row linked (see setRecurringLink),
    // which a batch has no single answer for.
    const linkRequested = recurringTransactionId !== undefined;
    if (
      linkRequested &&
      (ids.length !== 1 ||
        (recurringTransactionId !== null && typeof recurringTransactionId !== "string"))
    ) {
      return NextResponse.json({ error: "Invalid recurringTransactionId" }, { status: 400 });
    }

    // A split parent is a pure wrapper — only its (already-normal) children
    // carry a category. Reject the whole batch rather than silently skip, so
    // the caller sees why nothing changed for that row.
    // Scoped by writableTransactions, the same gate the update below uses: a
    // wrapper the caller could not have categorized anyway is not their
    // problem, and the tenant guard requires the statement to name user_id.
    //
    // A category reference must live in its ROW's owner space — on a shared
    // account that's the account owner, not necessarily the caller. So a
    // category id resolves to an owner (categoryOwnerId), and only rows that
    // owner actually owns may be set to it in this same batch.
    //
    // The two reads don't depend on each other, so they share one round trip.
    const [[splitParent], [targetCategory]] = await Promise.all([
      db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            inArray(transactions.id, ids),
            eq(transactions.isSplitParent, true),
            writableTransactions(userId),
          ),
        )
        .limit(1),
      categoryId
        ? db
            .select({ id: categories.id, userId: categories.userId })
            .from(categories)
            .where(eq(categories.id, categoryId))
        : Promise.resolve([]),
    ]);
    if (splitParent) {
      return apiError("api.splitParentAction", 400);
    }
    if (categoryId && !targetCategory) {
      return apiError("api.categoryNotFound", 404);
    }
    const categoryOwnerId: string | null = targetCategory?.userId ?? null;

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

    // A plan is a sub-category of the category it is filed under, so it can
    // only be picked with that category — or through a sub-line that stands
    // for it, whatever the plan's own category says. Same owner-space rule as
    // the sub-line above.
    let plan: LinkablePlan | null = null;
    if (typeof recurringTransactionId === "string") {
      if (!categoryOwnerId) return apiError("api.subCategoryWrongCategory", 400);
      const [found] = await db
        .select({
          id: recurringTransactions.id,
          accountId: recurringTransactions.accountId,
          matchPattern: recurringTransactions.matchPattern,
          categoryId: recurringTransactions.categoryId,
        })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.id, recurringTransactionId),
            eq(recurringTransactions.userId, categoryOwnerId),
          ),
        );
      if (!found) return apiError("api.recurringNotFound", 404);
      let viaSubLine = false;
      if (resolvedSubLineId) {
        const [line] = await db
          .select({ recurringTransactionId: budgetSubLines.recurringTransactionId })
          .from(budgetSubLines)
          .where(
            and(eq(budgetSubLines.id, resolvedSubLineId), eq(budgetSubLines.userId, categoryOwnerId)),
          );
        viaSubLine = line?.recurringTransactionId === found.id;
      }
      if (found.categoryId !== categoryId && !viaSubLine) {
        return apiError("api.subCategoryWrongCategory", 400);
      }
      plan = { id: found.id, accountId: found.accountId, matchPattern: found.matchPattern };
    }

    // The row the link is written to, read before the update so an unlink can
    // remember the plan it leaves. Same gate as the update: a row the caller
    // can't write, or one outside the category owner's space, is skipped.
    const [linkRow] = linkRequested
      ? await db
          .select({
            id: transactions.id,
            userId: transactions.userId,
            accountId: transactions.accountId,
            name: transactions.name,
            description: transactions.description,
            recurringTransactionId: transactions.recurringTransactionId,
            recurringExcludedPlanId: transactions.recurringExcludedPlanId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, ids[0]),
              writableTransactions(userId),
              ...(categoryOwnerId ? [eq(transactions.userId, categoryOwnerId)] : []),
            ),
          )
      : [];

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

    let learnedPattern: string | null = null;
    let alsoLinkedIds: string[] = [];
    // Only when it would change something: re-saving a row under the plan it
    // is already linked to must not log a link or re-learn anything.
    if (linkRow && linkRow.recurringTransactionId !== (plan?.id ?? null)) {
      ({ learnedPattern, alsoLinkedIds } = await setRecurringLink({
        actorId: userId,
        ownerId: linkRow.userId,
        row: linkRow,
        plan,
      }));
    }

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
      learnedPattern,
      alsoLinkedIds,
    });
  }, "Failed to categorize transaction");
}
