import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importBatches, transactions, accounts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";

/**
 * GET /api/import-batches
 * List all import batches for the current user, sorted by importedAt desc.
 */
export async function GET() {
  return withUser(async (userId) => {
    const rows = await db
      .select({
        id: importBatches.id,
        fileName: importBatches.fileName,
        transactionCount: importBatches.transactionCount,
        importedAt: importBatches.importedAt,
        accountName: accounts.name,
      })
      .from(importBatches)
      .leftJoin(accounts, eq(importBatches.accountId, accounts.id))
      .where(eq(importBatches.userId, userId))
      .orderBy(desc(importBatches.importedAt));

    return NextResponse.json(rows);
  }, "Failed to fetch import batches");
}

/**
 * DELETE /api/import-batches?id=<batchId>
 * Roll back an import batch: delete all its transactions and the batch record.
 */
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("id");

    if (!batchId) {
      return NextResponse.json(
        { error: "Batch ID is required" },
        { status: 400 }
      );
    }

    // Unscoped by caller — the write-access check below (via the batch's
    // account) decides who may roll it back, not row ownership.
    const [batch] = await db
      .select({ id: importBatches.id, accountId: importBatches.accountId, userId: importBatches.userId })
      .from(importBatches)
      .where(eq(importBatches.id, batchId));

    if (!batch) {
      return NextResponse.json(
        { error: "Import batch not found" },
        { status: 404 }
      );
    }
    const access = await requireAccountAccess(userId, batch.accountId, "write");
    const ownerId = access.account.userId;

    // Wrap the entire rollback in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Get all transactions in this batch
      const batchTxs = await tx
        .select({
          id: transactions.id,
          linkedTransactionId: transactions.linkedTransactionId,
        })
        .from(transactions)
        .where(and(eq(transactions.importBatchId, batchId), eq(transactions.userId, ownerId)));

      const batchTxIds = new Set(batchTxs.map((t) => t.id));

      // Handle linked transactions (internal transfers)
      for (const btx of batchTxs) {
        if (!btx.linkedTransactionId) continue;
        // Skip if the linked tx is also in this batch (will be deleted anyway)
        if (batchTxIds.has(btx.linkedTransactionId)) continue;

        // Scoped by the counterpart's OWN user_id: transfer detection pairs a
        // private account with a shared one, so the far leg may belong to
        // another user and must still be unlinked.
        const [linkedTx] = await tx
          .select({
            id: transactions.id,
            isManual: transactions.isManual,
            amount: transactions.amount,
            userId: transactions.userId,
          })
          .from(transactions)
          .where(eq(transactions.id, btx.linkedTransactionId));

        if (!linkedTx) continue;

        if (linkedTx.isManual) {
          // Auto-created mirror — delete it
          await tx
            .delete(transactions)
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, linkedTx.userId)));
        } else {
          // Came from another CSV import — revert to normal
          await tx
            .update(transactions)
            .set({
              type: linkedTx.amount >= 0 ? "income" : "expense",
              linkedTransactionId: null,
              categoryId: null,
            })
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, linkedTx.userId)));
        }
      }

      // Delete all transactions in this batch
      await tx
        .delete(transactions)
        .where(and(eq(transactions.importBatchId, batchId), eq(transactions.userId, ownerId)));

      // Delete the batch record
      await tx
        .delete(importBatches)
        .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, ownerId)));
    });

    return NextResponse.json({ success: true });
  }, "Failed to roll back import batch");
}
