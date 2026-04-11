import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importBatches, transactions, accounts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

/**
 * GET /api/import-batches
 * List all import batches for the current user, sorted by importedAt desc.
 */
export async function GET() {
  try {
    const userId = await getUserId();

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
  } catch (error) {
    console.error("Failed to fetch import batches:", error);
    return NextResponse.json(
      { error: "Failed to fetch import batches" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/import-batches?id=<batchId>
 * Roll back an import batch: delete all its transactions and the batch record.
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("id");

    if (!batchId) {
      return NextResponse.json(
        { error: "Batch ID is required" },
        { status: 400 }
      );
    }

    // Verify batch belongs to user
    const [batch] = await db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)));

    if (!batch) {
      return NextResponse.json(
        { error: "Import batch not found" },
        { status: 404 }
      );
    }

    // Wrap the entire rollback in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Get all transactions in this batch
      const batchTxs = await tx
        .select({
          id: transactions.id,
          linkedTransactionId: transactions.linkedTransactionId,
        })
        .from(transactions)
        .where(and(eq(transactions.importBatchId, batchId), eq(transactions.userId, userId)));

      const batchTxIds = new Set(batchTxs.map((t) => t.id));

      // Handle linked transactions (internal transfers)
      for (const btx of batchTxs) {
        if (!btx.linkedTransactionId) continue;
        // Skip if the linked tx is also in this batch (will be deleted anyway)
        if (batchTxIds.has(btx.linkedTransactionId)) continue;

        const [linkedTx] = await tx
          .select({
            id: transactions.id,
            isManual: transactions.isManual,
            amount: transactions.amount,
          })
          .from(transactions)
          .where(and(eq(transactions.id, btx.linkedTransactionId), eq(transactions.userId, userId)));

        if (!linkedTx) continue;

        if (linkedTx.isManual) {
          // Auto-created mirror — delete it
          await tx
            .delete(transactions)
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, userId)));
        } else {
          // Came from another CSV import — revert to normal
          await tx
            .update(transactions)
            .set({
              type: linkedTx.amount >= 0 ? "income" : "expense",
              linkedTransactionId: null,
              categoryId: null,
            })
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, userId)));
        }
      }

      // Delete all transactions in this batch
      await tx
        .delete(transactions)
        .where(and(eq(transactions.importBatchId, batchId), eq(transactions.userId, userId)));

      // Delete the batch record
      await tx
        .delete(importBatches)
        .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to roll back import batch:", error);
    return NextResponse.json(
      { error: "Failed to roll back import batch" },
      { status: 500 }
    );
  }
}
