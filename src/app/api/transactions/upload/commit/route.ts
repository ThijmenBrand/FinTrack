import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import {
  transactions,
  importBatches,
  categoryRules,
  categories,
  accounts,
  recurringTransactions,
  transactionGroups,
  reimbursementLinks,
} from "@/db/schema";
import { eq, and, lt, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { detectTransfers, findTransferCategory } from "@/lib/detect-transfers";
import { logDataEvent } from "@/lib/audit";
import {
  validatePattern,
  sanitizeNote,
  isFiniteNumber,
  isIsoDate,
  isMatchType,
  isMatchField,
} from "@/lib/validation";
const TX_TYPES = ["income", "expense", "internal_transfer", "reimbursement"] as const;
type TxType = (typeof TX_TYPES)[number];

// Backstop against unbounded request bodies — a real bank CSV is far smaller.
const MAX_IMPORT_ROWS = 5000;
import { matchesRule, ruleMatchTarget, splitDuplicates } from "@/lib/csv-utils";
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
  groupId?: string | null;
  reimbursesExpenseId?: string | null;
  reimbursesTempId?: string | null;
  notes?: string | null;
  targetAccountId?: string;
  recurringTransactionId?: string | null;
}

interface NewRule {
  pattern: string;
  categoryId: string;
  matchType: "contains" | "exact" | "starts_with";
  matchField?: "both" | "name" | "description";
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
    if (txList.length > MAX_IMPORT_ROWS) {
      return apiError("api.tooManyTransactions", 400, { max: MAX_IMPORT_ROWS });
    }

    // Write access to the target account — 404 if the caller can't see it,
    // 403 if they're a viewer. Every id the client references below must
    // belong to the ACCOUNT OWNER's space, not necessarily the caller's own —
    // imported rows land there regardless of who's importing.
    const access = await requireAccountAccess(userId, accountId, "write");
    const ownerId = access.account.userId;

    const ownerAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, ownerId));
    const ownerAccountIds = new Set(ownerAccounts.map((a) => a.id));

    const ownerPlans = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(eq(recurringTransactions.userId, ownerId));
    const ownerPlanIds = new Set(ownerPlans.map((p) => p.id));

    const ownerCategoryRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.userId, ownerId));
    const ownerCategoryIds = new Set(ownerCategoryRows.map((c) => c.id));

    // Validate every row before writing anything — no partial imports.
    for (const [i, tx] of txList.entries()) {
      if (!TX_TYPES.includes(tx.type as TxType)) {
        return apiError("api.invalidTypeOnRow", 400, { n: i + 1 });
      }
      if (!isFiniteNumber(tx.amount)) {
        return apiError("api.invalidAmountOnRow", 400, { n: i + 1 });
      }
      if (tx.balance != null && !isFiniteNumber(tx.balance)) {
        return apiError("api.invalidBalanceOnRow", 400, { n: i + 1 });
      }
      if (!isIsoDate(tx.date)) {
        return apiError("api.invalidDateOnRow", 400, { n: i + 1 });
      }
      if (typeof tx.description !== "string") {
        return apiError("api.invalidDescriptionOnRow", 400, { n: i + 1 });
      }
      if (tx.name != null && typeof tx.name !== "string") {
        return apiError("api.invalidNameOnRow", 400, { n: i + 1 });
      }
      if (tx.categoryId && !ownerCategoryIds.has(tx.categoryId)) {
        return apiError("api.unknownCategoryOnRow", 400, { n: i + 1 });
      }
      if (tx.targetAccountId && !ownerAccountIds.has(tx.targetAccountId)) {
        return apiError("api.unknownAccountOnRow", 400, { n: i + 1 });
      }
      if (tx.recurringTransactionId && !ownerPlanIds.has(tx.recurringTransactionId)) {
        return apiError("api.unknownRecurringOnRow", 400, { n: i + 1 });
      }
    }

    // Validate all rule patterns upfront so we don't write a partial import.
    const cleanRules: NewRule[] = [];
    for (const rule of newRules || []) {
      if (!rule.pattern || !rule.categoryId) continue;
      if (!ownerCategoryIds.has(rule.categoryId)) {
        return apiError("api.unknownCategoryOnRule", 400);
      }
      const validated = validatePattern(rule.pattern);
      if (!validated.ok) {
        return apiError(validated.error, 400, validated.vars);
      }
      cleanRules.push({
        ...rule,
        pattern: validated.value,
        matchType: isMatchType(rule.matchType) ? rule.matchType : "contains",
        matchField: isMatchField(rule.matchField) ? rule.matchField : "both",
      });
    }

    // Skip rows already in this account — re-importing an overlapping CSV
    // export must not double-count (Revolut exports can overlap and even
    // translate descriptions between languages, see splitDuplicates).
    const existingRows = await db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        balance: transactions.balance,
        description: transactions.description,
      })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, ownerId)));
    const { unique: uniqueTxList, duplicates } = splitDuplicates(existingRows, txList);

    // Create import batch — kept in the OWNER's import history regardless of
    // who's importing; the audit log records the actor.
    const batchId = crypto.randomUUID();
    if (uniqueTxList.length > 0) {
      await db.insert(importBatches).values({
        id: batchId,
        userId: ownerId,
        accountId,
        fileName: fileName || "import.csv",
        transactionCount: uniqueTxList.length,
        importedAt: new Date().toISOString(),
      });
    }

    // Get the "Internal Transfer" category for mirror transactions
    const transferCategory = await findTransferCategory(db, ownerId);

    // Only allow pot assignments to pots the owner actually owns
    const ownerPots = await db
      .select({ id: transactionGroups.id })
      .from(transactionGroups)
      .where(eq(transactionGroups.userId, ownerId));
    const ownerPotIds = new Set(ownerPots.map((p) => p.id));

    // Pre-fetch active rules so we can detect, per row, whether an incoming
    // categoryId is the result of a rule match (auto) or a user override during
    // review. Overrides must be marked 'manual' so Recalculate All preserves them.
    const activeRules = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, ownerId)));

    const sourceForReviewedTx = (
      name: string | null,
      description: string,
      categoryId: string | null
    ): "manual" | "rule" | null => {
      if (!categoryId) return null;
      for (const rule of activeRules) {
        const matchTarget = ruleMatchTarget(name, description, rule.matchField);
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
      type: "income" | "expense" | "internal_transfer" | "reimbursement";
      groupId: string | null;
      linkedTransactionId: string | null;
      recurringTransactionId: string | null;
      notes: string | null;
      createdBy: string;
      isManual: boolean;
      importBatchId: string | null;
      createdAt: string;
    }> = [];

    const mirrorRecords: typeof records = [];
    // Reimbursement rows link to an expense chosen during review: either an
    // existing DB expense (expenseId) or another row in this same import
    // (expenseTempId, resolved to its new id after the map is fully built).
    const pendingReimbursements: Array<{
      reimbursementId: string;
      expenseId: string | null;
      expenseTempId: string | null;
    }> = [];
    // tempId → the id we assign the row on insert, for resolving sibling links.
    const tempIdToSourceId = new Map<string, string>();

    for (const tx of uniqueTxList) {
      const sourceId = crypto.randomUUID();
      tempIdToSourceId.set(tx.tempId, sourceId);
      const note = sanitizeNote(tx.notes);
      const isTransfer = tx.type === "internal_transfer" && tx.targetAccountId;

      if (isTransfer) {
        const mirrorId = crypto.randomUUID();
        const transferCatId = transferCategory?.id || tx.categoryId;
        // Source transaction (in the importing account)
        records.push({
          id: sourceId,
          userId: ownerId,
          accountId,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: tx.amount,
          balance: tx.balance,
          categoryId: transferCatId,
          categorySource: transferCatId ? "rule" : null,
          type: "internal_transfer",
          groupId: null,
          linkedTransactionId: mirrorId,
          recurringTransactionId: null,
          notes: note,
          createdBy: userId,
          isManual: false,
          importBatchId: batchId,
          createdAt: new Date().toISOString(),
        });
        // Mirror transaction (in the target account)
        mirrorRecords.push({
          id: mirrorId,
          userId: ownerId,
          accountId: tx.targetAccountId!,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: -tx.amount,
          balance: null,
          categoryId: transferCatId,
          categorySource: transferCatId ? "rule" : null,
          type: "internal_transfer",
          groupId: null,
          linkedTransactionId: sourceId,
          recurringTransactionId: null,
          notes: note,
          createdBy: userId,
          isManual: true,
          importBatchId: null,
          createdAt: new Date().toISOString(),
        });
      } else {
        const txType = (
          ["income", "expense", "internal_transfer", "reimbursement"] as const
        ).find((t) => t === tx.type) ?? "expense";
        records.push({
          id: sourceId,
          userId: ownerId,
          accountId,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: tx.amount,
          balance: tx.balance,
          categoryId: tx.categoryId,
          categorySource: sourceForReviewedTx(tx.name, tx.description, tx.categoryId),
          type: txType,
          groupId: tx.groupId && ownerPotIds.has(tx.groupId) ? tx.groupId : null,
          linkedTransactionId: null,
          // Only carry the recurring link for income/expense rows; transfers
          // don't represent fixed-cost spending.
          recurringTransactionId:
            (txType === "income" || txType === "expense") && tx.recurringTransactionId
              ? tx.recurringTransactionId
              : null,
          notes: note,
          createdBy: userId,
          isManual: false,
          importBatchId: batchId,
          createdAt: new Date().toISOString(),
        });
        if (txType === "reimbursement" && tx.amount > 0 && (tx.reimbursesExpenseId || tx.reimbursesTempId)) {
          pendingReimbursements.push({
            reimbursementId: sourceId,
            expenseId: tx.reimbursesExpenseId ?? null,
            expenseTempId: tx.reimbursesTempId ?? null,
          });
        }
      }
    }

    // Batch insert all transactions (SQLite limit workaround)
    const allRecords = [...records, ...mirrorRecords];
    const chunkSize = 50;
    for (let i = 0; i < allRecords.length; i += chunkSize) {
      const chunk = allRecords.slice(i, i + chunkSize);
      await db.insert(transactions).values(chunk);
    }

    // Link reimbursements to their expenses; only user-owned negative-amount
    // transactions qualify (same rules as /api/transactions/reimburse)
    // Resolve sibling (same-import) targets to the ids we just assigned; a
    // target dropped as a duplicate has no new id and is silently skipped.
    const resolvedReimbursements = pendingReimbursements
      .map((p) => ({
        reimbursementId: p.reimbursementId,
        expenseId: p.expenseId ?? (p.expenseTempId ? tempIdToSourceId.get(p.expenseTempId) ?? null : null),
      }))
      .filter((p): p is { reimbursementId: string; expenseId: string } => p.expenseId !== null);
    if (resolvedReimbursements.length > 0) {
      const validExpenses = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            inArray(transactions.id, resolvedReimbursements.map((p) => p.expenseId)),
            eq(transactions.userId, ownerId),
            lt(transactions.amount, 0)
          )
        );
      const validExpenseIds = new Set(validExpenses.map((e) => e.id));
      const linkRows = resolvedReimbursements
        .filter((p) => validExpenseIds.has(p.expenseId))
        .map((p) => ({
          id: crypto.randomUUID(),
          reimbursementId: p.reimbursementId,
          expenseId: p.expenseId,
          createdAt: new Date().toISOString(),
        }));
      if (linkRows.length > 0) {
        await db.insert(reimbursementLinks).values(linkRows).onConflictDoNothing();
      }
    }

    // Create new rules and apply them to existing uncategorized transactions
    let rulesCreated = 0;
    let existingUpdated = 0;

    for (const rule of cleanRules) {
      const ruleId = crypto.randomUUID();
      await db.insert(categoryRules).values({
        id: ruleId,
        userId: ownerId,
        pattern: rule.pattern,
        categoryId: rule.categoryId,
        matchType: rule.matchType || "contains",
        matchField: rule.matchField || "both",
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
        matchField: rule.matchField || "both",
        userId: ownerId,
      });
    }

    // Auto-detect internal transfers among all transactions. Run as the
    // IMPORTER, not the owner: their writable scope spans their own accounts
    // plus this shared one, so a move between the two gets paired. Pairs that
    // need an owner account the importer can't see are left to the owner's own
    // run — we don't reach into accounts the actor can't access.
    const transferResult = await detectTransfers(db, userId);

    logDataEvent({
      userId,
      action: "csv_import",
      targetId: batchId,
      targetType: "import_batch",
      details: {
        fileName: fileName || "import.csv",
        transactionCount: records.length,
        accountId,
        ...(ownerId !== userId ? { accountOwnerId: ownerId } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      imported: records.length,
      duplicatesSkipped: duplicates.length,
      mirrorTransactions: mirrorRecords.length,
      batchId,
      rulesCreated,
      existingUpdated,
      transfersDetected: transferResult.matchedPairs,
    });
  }, "Failed to commit import");
}
