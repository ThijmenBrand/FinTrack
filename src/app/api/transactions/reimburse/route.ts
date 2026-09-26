import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactions, reimbursementLinks } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";

/**
 * The expense ids a POST names, deduplicated — or null when the field isn't a
 * non-empty array of non-empty strings.
 */
function parseExpenseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((id) => typeof id === "string" && id.length > 0)) return null;
  return [...new Set(raw as string[])];
}

/**
 * POST /api/transactions/reimburse
 * Link an income transaction as a reimbursement of one or more expenses.
 * Body: { transactionId: string, expenseIds: string[] }
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);
    const transactionId: unknown = body?.transactionId;
    const expenseIds = parseExpenseIds(body?.expenseIds);

    if (typeof transactionId !== "string" || !transactionId || !expenseIds) {
      return NextResponse.json(
        { error: "transactionId and at least one expenseId are required" },
        { status: 400 }
      );
    }

    // Fetch the reimbursement transaction
    const [reimbursement] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    if (!reimbursement) {
      return apiError("api.reimbursementNotFound", 404);
    }

    if (reimbursement.amount <= 0) {
      return apiError("api.reimbursementMustBePositive", 400);
    }

    // A split parent is a pure wrapper — it can't be reimbursement-linked
    // itself (its children, which carry the real amounts, can be).
    if (reimbursement.isSplitParent) {
      return apiError("api.splitParentAction", 409);
    }

    // Fetch and validate all expenses
    const expenses = await db
      .select()
      .from(transactions)
      .where(and(inArray(transactions.id, expenseIds), eq(transactions.userId, userId)));

    if (expenses.length !== expenseIds.length) {
      return apiError("api.expensesNotFound", 404);
    }

    const invalidExpense = expenses.find((e) => e.amount >= 0);
    if (invalidExpense) {
      return apiError("api.expensesMustBeNegative", 400);
    }

    if (expenses.some((e) => e.isSplitParent)) {
      return apiError("api.splitParentAction", 409);
    }

    // Insert links into the junction table, skipping pairs already linked. The
    // pair's unique index lives only in initializeDatabase, not in schema.ts,
    // so don't lean on it: a duplicate row would skew the pro-rata share every
    // linked expense gets (see effectiveExpenseAmount).
    const existing = await db
      .select({ expenseId: reimbursementLinks.expenseId })
      .from(reimbursementLinks)
      .where(
        and(
          eq(reimbursementLinks.reimbursementId, transactionId),
          inArray(reimbursementLinks.expenseId, expenseIds),
        ),
      );
    const alreadyLinked = new Set(existing.map((l) => l.expenseId));
    const now = new Date().toISOString();
    for (const expenseId of expenseIds.filter((id) => !alreadyLinked.has(id))) {
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
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    return NextResponse.json({ success: true });
  }, "Failed to link reimbursement");
}

/**
 * DELETE /api/transactions/reimburse?id=<transactionId>[&expenseId=<expenseId>]
 * Unlink a reimbursement. If expenseId is provided, unlinks just that expense.
 * If no expenseId, unlinks all. If no links remain, restores type to "income".
 */
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
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
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));

    if (!tx) {
      return apiError("api.transactionNotFound", 404);
    }

    if (tx.type !== "reimbursement") {
      return apiError("api.notAReimbursement", 400);
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
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    }

    return NextResponse.json({ success: true });
  }, "Failed to unlink reimbursement");
}
