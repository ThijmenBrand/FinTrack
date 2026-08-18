import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactions, recurringTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { requireAccountAccess } from "@/lib/account-access";

// PUT /api/transactions/recurring — link or unlink a transaction to a recurring plan.
// Pass `recurringTransactionId: null` to clear the link.
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { transactionId, recurringTransactionId } = body as {
      transactionId?: string;
      recurringTransactionId?: string | null;
    };

    if (!transactionId) {
      return NextResponse.json(
        { error: "transactionId is required" },
        { status: 400 }
      );
    }

    const [tx] = await db
      .select({ accountId: transactions.accountId, userId: transactions.userId })
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    if (!tx) {
      return apiError("api.transactionNotFound", 404);
    }
    const access = await requireAccountAccess(userId, tx.accountId, "write");
    const ownerId = access.account.userId;

    if (recurringTransactionId) {
      const [plan] = await db
        .select({ id: recurringTransactions.id })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.id, recurringTransactionId),
            eq(recurringTransactions.userId, ownerId)
          )
        );
      if (!plan) {
        return apiError("api.recurringNotFound", 404);
      }
    }

    await db
      .update(transactions)
      .set({ recurringTransactionId: recurringTransactionId ?? null, modifiedBy: userId })
      .where(
        and(eq(transactions.id, transactionId), eq(transactions.userId, ownerId))
      );

    logDataEvent({
      userId,
      action: recurringTransactionId
        ? "transaction_link_recurring"
        : "transaction_unlink_recurring",
      targetId: transactionId,
      targetType: "transaction",
      details: {
        recurringTransactionId: recurringTransactionId ?? null,
        ...(ownerId !== userId ? { accountOwnerId: ownerId } : {}),
      },
    });

    return NextResponse.json({ success: true });
  }, "Failed to update recurring link");
}
