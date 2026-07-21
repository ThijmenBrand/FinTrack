import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, reimbursementLinks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";

/**
 * GET /api/transactions/reimburse/expenses?reimbursementId=<id>
 * Returns the expenses linked to a reimbursement transaction via the junction table.
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const reimbursementId = searchParams.get("reimbursementId");

    if (!reimbursementId) {
      return NextResponse.json(
        { error: "reimbursementId is required" },
        { status: 400 }
      );
    }

    const links = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        amount: transactions.amount,
      })
      .from(reimbursementLinks)
      .innerJoin(transactions, eq(transactions.id, reimbursementLinks.expenseId))
      .where(and(eq(reimbursementLinks.reimbursementId, reimbursementId), eq(transactions.userId, userId)));

    return NextResponse.json({ expenses: links });
  }, "Failed to fetch linked expenses");
}
