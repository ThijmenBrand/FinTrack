import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categoryRules, categories } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { validatePattern } from "@/lib/validation";

// PUT /api/transactions/categorize — categorize a transaction (and optionally create a rule)
export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const { transactionId, categoryId, createRule, rulePattern, ruleMatchType } = body;

    if (!transactionId) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 }
      );
    }

    // Look up target category to derive transaction type from category kind
    // (kind='reserved' → type='reserved'; "Internal Transfer" → 'internal_transfer').
    const [targetCategory] = categoryId
      ? await db
          .select({ name: categories.name, kind: categories.kind })
          .from(categories)
          .where(eq(categories.id, categoryId))
      : [null];

    const [currentTx] = await db
      .select({ amount: transactions.amount, type: transactions.type })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    const isAssigningTransfer = targetCategory?.name === "Internal Transfer";
    const isAssigningReserved = targetCategory?.kind === "reserved";
    const isRemovingTransfer = !isAssigningTransfer && currentTx?.type === "internal_transfer";
    const isRemovingReserved = !isAssigningReserved && currentTx?.type === "reserved";

    // Build update: sync type with category
    const updateSet: Record<string, unknown> = {
      categoryId: categoryId || null,
      categorySource: categoryId ? "manual" : null,
    };

    if (isAssigningTransfer) {
      updateSet.type = "internal_transfer";
    } else if (isAssigningReserved) {
      updateSet.type = "reserved";
    } else if (isRemovingTransfer && currentTx) {
      updateSet.type = currentTx.amount >= 0 ? "income" : "expense";
      updateSet.linkedTransactionId = null;
    } else if (isRemovingReserved && currentTx) {
      updateSet.type = currentTx.amount >= 0 ? "income" : "expense";
    }

    // Update the transaction's category (and type if needed)
    await db
      .update(transactions)
      .set(updateSet)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

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
      let sqlPattern: string;
      switch (matchType) {
        case "exact":
          sqlPattern = cleanPattern;
          break;
        case "starts_with":
          sqlPattern = `${cleanPattern}%`;
          break;
        case "contains":
        default:
          sqlPattern = `%${cleanPattern}%`;
          break;
      }

      const matchTargetSql = sql`LOWER(IIF(${transactions.name} IS NOT NULL, ${transactions.name} || ' — ', '') || ${transactions.description})`;
      const condition =
        matchType === "exact"
          ? sql`${matchTargetSql} = LOWER(${cleanPattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`
          : sql`${matchTargetSql} LIKE LOWER(${sqlPattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId} AND ${transactions.type} IN ('income', 'expense')`;

      const ruleUpdate: Record<string, unknown> = {
        categoryId,
        categorySource: "rule",
      };
      if (isAssigningReserved) ruleUpdate.type = "reserved";

      const result = await db
        .update(transactions)
        .set(ruleUpdate)
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
