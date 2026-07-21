import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, recurringTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";

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

    if (recurringTransactionId) {
      const [plan] = await db
        .select({ id: recurringTransactions.id })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.id, recurringTransactionId),
            eq(recurringTransactions.userId, userId)
          )
        );
      if (!plan) {
        return NextResponse.json(
          { error: "Recurring plan not found" },
          { status: 404 }
        );
      }
    }

    const result = await db
      .update(transactions)
      .set({ recurringTransactionId: recurringTransactionId ?? null })
      .where(
        and(eq(transactions.id, transactionId), eq(transactions.userId, userId))
      );

    if (result.rowsAffected === 0) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    logDataEvent({
      userId,
      action: recurringTransactionId
        ? "transaction_link_recurring"
        : "transaction_unlink_recurring",
      targetId: transactionId,
      targetType: "transaction",
      details: { recurringTransactionId: recurringTransactionId ?? null },
    });

    return NextResponse.json({ success: true });
  }, "Failed to update recurring link");
}
