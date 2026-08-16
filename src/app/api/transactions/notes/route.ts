import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { sanitizeNote } from "@/lib/validation";
import { requireAccountAccess } from "@/lib/account-access";

// PUT /api/transactions/notes — set or clear a transaction's note
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const { transactionId, notes } = await request.json();

    if (typeof transactionId !== "string" || !transactionId) {
      return NextResponse.json(
        { error: "transactionId is required" },
        { status: 400 }
      );
    }
    if (notes !== null && notes !== undefined && typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string or null" },
        { status: 400 }
      );
    }

    const [tx] = await db
      .select({ accountId: transactions.accountId, userId: transactions.userId })
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    if (!tx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    const access = await requireAccountAccess(userId, tx.accountId, "write");
    const ownerId = access.account.userId;

    const clean = sanitizeNote(notes);
    await db
      .update(transactions)
      .set({ notes: clean, modifiedBy: userId })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, ownerId)));

    return NextResponse.json({ success: true, notes: clean });
  }, "Failed to update notes");
}
