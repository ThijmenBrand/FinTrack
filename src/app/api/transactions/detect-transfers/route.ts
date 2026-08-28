import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { requireAccountAccess } from "@/lib/account-access";
import { detectTransfers, undoTransfer } from "@/lib/detect-transfers";
import { logDataEvent } from "@/lib/audit";

/**
 * POST /api/transactions/detect-transfers
 *
 * Detects internal transfers between accounts.
 * Logic: If money leaves Account A and enters Account B within ±2 days
 * with the same absolute amount, flag both as "Internal Transfer".
 *
 * This prevents internal moves from inflating income/expense totals.
 */
export async function POST() {
  return withUser(async (userId) => {
    const result = await detectTransfers(db, userId);

    return NextResponse.json({
      success: true,
      matchedPairs: result.matchedPairs,
      totalTransactionsUpdated: result.totalTransactionsUpdated,
    });
  }, "Failed to detect transfers");
}

/**
 * DELETE /api/transactions/detect-transfers?id=<transactionId>
 *
 * Undo one wrong guess: the row and its counterpart go back to plain
 * income/expense. Money you got back from someone else looks identical to a
 * move between your own accounts, so the detector needs an escape hatch.
 *
 * `counterparts` is the far leg(s) this rewrote — on another account, now
 * uncategorized. Returned so the UI can say so instead of leaving half the
 * pair silently broken.
 */
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Transaction ID is required" }, { status: 400 });
    }

    // Row lookup is unscoped by caller — write access to the row's account
    // decides who may change it, not row ownership (see the DELETE in
    // /api/transactions).
    const [tx] = await db
      // userId is in the projection to satisfy the tenant tripwire; access is
      // decided by requireAccountAccess below.
      .select({
        accountId: transactions.accountId,
        type: transactions.type,
        userId: transactions.userId,
      })
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!tx) return apiError("api.transactionNotFound", 404);
    if (tx.type !== "internal_transfer") return apiError("api.notATransfer", 400);

    const access = await requireAccountAccess(userId, tx.accountId, "write");
    const { reverted, counterparts } = await undoTransfer(db, id, userId);

    logDataEvent({
      userId,
      action: "transaction_undo_transfer",
      targetId: id,
      targetType: "transaction",
      details: access.account.userId !== userId ? { accountOwnerId: access.account.userId } : undefined,
    });

    return NextResponse.json({ success: true, reverted, counterparts });
  }, "Failed to undo transfer");
}
