import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, importBatches, categoryRules, categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { detectTransfers } from "@/lib/detect-transfers";
import { logDataEvent } from "@/lib/audit";
import { validatePattern, sanitizeNote } from "@/lib/validation";
import { matchesRule } from "@/lib/csv-utils";
import { applyRuleToTransactions } from "@/lib/apply-rule";

interface CommitTransaction {
  tempId: string;
  date: string;
  name: string | null;
  description: string;
  amount: number;
  balance: number | null;
  type: string;
  categoryId: string | null;
  notes?: string | null;
  targetAccountId?: string;
  recurringTransactionId?: string | null;
}

interface NewRule {
  pattern: string;
  categoryId: string;
  matchType: "contains" | "exact" | "starts_with";
}

interface CommitRequest {
  accountId: string;
  fileName: string;
  transactions: CommitTransaction[];
  newRules: NewRule[];
}

/**
 * POST /api/transactions/upload/commit
 * Insert reviewed transactions into the database and create any new rules.
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body: CommitRequest = await request.json();
    const { accountId, fileName, transactions: txList, newRules } = body;

    if (!accountId || !txList || txList.length === 0) {
      return NextResponse.json(
        { error: "accountId and transactions are required" },
        { status: 400 }
      );
    }

    // Validate all rule patterns upfront so we don't write a partial import.
    const cleanRules: NewRule[] = [];
    for (const rule of newRules || []) {
      if (!rule.pattern || !rule.categoryId) continue;
      const validated = validatePattern(rule.pattern);
      if (!validated.ok) {
        return NextResponse.json(
          { error: `Invalid rule pattern: ${validated.error}` },
          { status: 400 }
        );
      }
      cleanRules.push({ ...rule, pattern: validated.value });
    }

    // Create import batch
    const batchId = crypto.randomUUID();
    await db.insert(importBatches).values({
      id: batchId,
      userId,
      accountId,
      fileName: fileName || "import.csv",
      transactionCount: txList.length,
      importedAt: new Date().toISOString(),
    });

    // Get the "Internal Transfer" category for mirror transactions
    const [transferCategory] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.name, "Internal Transfer"), eq(categories.userId, userId)));

    // Reserved category IDs — when a rule maps a transaction here, type='reserved'.
    const categoryKindRows = await db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.userId, userId));
    const reservedCategoryIds = new Set(
      categoryKindRows.filter((c) => c.kind === "reserved").map((c) => c.id)
    );

    // Pre-fetch active rules so we can detect, per row, whether an incoming
    // categoryId is the result of a rule match (auto) or a user override during
    // review. Overrides must be marked 'manual' so Recalculate All preserves them.
    const activeRules = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, userId)));

    const sourceForReviewedTx = (
      name: string | null,
      description: string,
      categoryId: string | null
    ): "manual" | "rule" | null => {
      if (!categoryId) return null;
      const matchTarget = name ? `${name} — ${description}` : description;
      for (const rule of activeRules) {
        if (matchesRule(matchTarget, rule.pattern, rule.matchType) && rule.categoryId === categoryId) {
          return "rule";
        }
      }
      return "manual";
    };

    // Build transaction records, creating mirror transactions for internal transfers
    const records: Array<{
      id: string;
      userId: string;
      accountId: string;
      date: string;
      name: string | null;
      description: string;
      amount: number;
      balance: number | null;
      categoryId: string | null;
      categorySource: "manual" | "rule" | null;
      type: "income" | "expense" | "internal_transfer" | "reserved";
      linkedTransactionId: string | null;
      recurringTransactionId: string | null;
      notes: string | null;
      isManual: boolean;
      importBatchId: string | null;
      createdAt: string;
    }> = [];

    const mirrorRecords: typeof records = [];

    for (const tx of txList) {
      const sourceId = crypto.randomUUID();
      const note = sanitizeNote(tx.notes);
      const isTransfer = tx.type === "internal_transfer" && tx.targetAccountId;

      if (isTransfer) {
        const mirrorId = crypto.randomUUID();
        const transferCatId = transferCategory?.id || tx.categoryId;
        // Source transaction (in the importing account)
        records.push({
          id: sourceId,
          userId,
          accountId,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: tx.amount,
          balance: tx.balance,
          categoryId: transferCatId,
          categorySource: transferCatId ? "rule" : null,
          type: "internal_transfer",
          linkedTransactionId: mirrorId,
          recurringTransactionId: null,
          notes: note,
          isManual: false,
          importBatchId: batchId,
          createdAt: new Date().toISOString(),
        });
        // Mirror transaction (in the target account)
        mirrorRecords.push({
          id: mirrorId,
          userId,
          accountId: tx.targetAccountId!,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: -tx.amount,
          balance: null,
          categoryId: transferCatId,
          categorySource: transferCatId ? "rule" : null,
          type: "internal_transfer",
          linkedTransactionId: sourceId,
          recurringTransactionId: null,
          notes: note,
          isManual: true,
          importBatchId: null,
          createdAt: new Date().toISOString(),
        });
      } else {
        const txType = tx.type as "income" | "expense" | "internal_transfer" | "reserved";
        records.push({
          id: sourceId,
          userId,
          accountId,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: tx.amount,
          balance: tx.balance,
          categoryId: tx.categoryId,
          categorySource: sourceForReviewedTx(tx.name, tx.description, tx.categoryId),
          type: txType,
          linkedTransactionId: null,
          // Only carry the recurring link for income/expense rows; transfers
          // and reserved transactions don't represent fixed-cost spending.
          recurringTransactionId:
            (txType === "income" || txType === "expense") && tx.recurringTransactionId
              ? tx.recurringTransactionId
              : null,
          notes: note,
          isManual: false,
          importBatchId: batchId,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Batch insert all transactions (SQLite limit workaround)
    const allRecords = [...records, ...mirrorRecords];
    const chunkSize = 50;
    for (let i = 0; i < allRecords.length; i += chunkSize) {
      const chunk = allRecords.slice(i, i + chunkSize);
      await db.insert(transactions).values(chunk);
    }

    // Create new rules and apply them to existing uncategorized transactions
    let rulesCreated = 0;
    let existingUpdated = 0;

    for (const rule of cleanRules) {
      const ruleId = crypto.randomUUID();
      await db.insert(categoryRules).values({
        id: ruleId,
        userId,
        pattern: rule.pattern,
        categoryId: rule.categoryId,
        matchType: rule.matchType || "contains",
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      rulesCreated++;

      // Apply rule to existing uncategorized transactions in the DB
      // (not the ones we just imported — those already have categories from the review)
      existingUpdated += await applyRuleToTransactions({
        pattern: rule.pattern,
        categoryId: rule.categoryId,
        matchType: rule.matchType || "contains",
        userId,
        isReserved: reservedCategoryIds.has(rule.categoryId),
      });
    }

    // Auto-detect internal transfers among all transactions
    const transferResult = await detectTransfers(db, userId);

    logDataEvent({
      userId,
      action: "csv_import",
      targetId: batchId,
      targetType: "import_batch",
      details: { fileName: fileName || "import.csv", transactionCount: records.length, accountId },
    });

    return NextResponse.json({
      success: true,
      imported: records.length,
      mirrorTransactions: mirrorRecords.length,
      batchId,
      rulesCreated,
      existingUpdated,
      transfersDetected: transferResult.matchedPairs,
    });
  }, "Failed to commit import");
}
