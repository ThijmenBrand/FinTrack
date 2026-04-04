import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, reimbursementLinks } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

/**
 * POST /api/transactions/reimburse
 * Link an income transaction as a reimbursement of one or more expenses.
 * Body: { transactionId: string, expenseIds: string[] }
 * Also accepts legacy { transactionId: string, expenseId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const transactionId: string = body.transactionId;
    // Support both single expenseId and array of expenseIds
    const expenseIds: string[] = body.expenseIds || (body.expenseId ? [body.expenseId] : []);

    if (!transactionId || expenseIds.length === 0) {
      return NextResponse.json(
        { error: "transactionId and at least one expenseId are required" },
        { status: 400 }
      );
    }

    // Fetch the reimbursement transaction
    const [reimbursement] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId));

    if (!reimbursement) {
      return NextResponse.json(
        { error: "Reimbursement transaction not found" },
        { status: 404 }
      );
    }

    if (reimbursement.amount <= 0) {
      return NextResponse.json(
        { error: "Reimbursement transaction must have a positive amount" },
        { status: 400 }
      );
    }

    // Fetch and validate all expenses
    const expenses = await db
      .select()
      .from(transactions)
      .where(inArray(transactions.id, expenseIds));

    if (expenses.length !== expenseIds.length) {
      return NextResponse.json(
        { error: "One or more expense transactions not found" },
        { status: 404 }
      );
    }

    const invalidExpense = expenses.find((e) => e.amount >= 0);
    if (invalidExpense) {
      return NextResponse.json(
        { error: "All expense transactions must have a negative amount" },
        { status: 400 }
      );
    }

    // Insert links into the junction table
    const now = new Date().toISOString();
    for (const expenseId of expenseIds) {
      await db
        .insert(reimbursementLinks)
        .values({
          id: crypto.randomUUID(),
          reimbursementId: transactionId,
          expenseId,
          createdAt: now,
        })
        .onConflictDoNothing();
    }

    // Set the transaction type to reimbursement
    await db
      .update(transactions)
      .set({ type: "reimbursement" })
      .where(eq(transactions.id, transactionId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to link reimbursement:", error);
    return NextResponse.json(
      { error: "Failed to link reimbursement" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/transactions/reimburse?id=<transactionId>[&expenseId=<expenseId>]
 * Unlink a reimbursement. If expenseId is provided, unlinks just that expense.
 * If no expenseId, unlinks all. If no links remain, restores type to "income".
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const expenseId = searchParams.get("expenseId");

    if (!id) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 }
      );
    }

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));

    if (!tx) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    if (tx.type !== "reimbursement") {
      return NextResponse.json(
        { error: "Transaction is not a reimbursement" },
        { status: 400 }
      );
    }

    if (expenseId) {
      // Remove single link
      await db
        .delete(reimbursementLinks)
        .where(
          and(
            eq(reimbursementLinks.reimbursementId, id),
            eq(reimbursementLinks.expenseId, expenseId)
          )
        );
    } else {
      // Remove all links
      await db
        .delete(reimbursementLinks)
        .where(eq(reimbursementLinks.reimbursementId, id));
    }

    // Check if any links remain
    const remaining = await db
      .select({ count: sql<number>`count(*)` })
      .from(reimbursementLinks)
      .where(eq(reimbursementLinks.reimbursementId, id));

    if ((remaining[0]?.count || 0) === 0) {
      // No links left — revert to income
      await db
        .update(transactions)
        .set({ type: "income" })
        .where(eq(transactions.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to unlink reimbursement:", error);
    return NextResponse.json(
      { error: "Failed to unlink reimbursement" },
      { status: 500 }
    );
  }
}
