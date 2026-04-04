import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, reimbursementLinks } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/transactions/reimburse/expenses?reimbursementId=<id>
 * Returns the expenses linked to a reimbursement transaction via the junction table.
 */
export async function GET(request: NextRequest) {
  try {
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
      .where(eq(reimbursementLinks.reimbursementId, reimbursementId));

    return NextResponse.json({ expenses: links });
  } catch (error) {
    console.error("Failed to fetch linked expenses:", error);
    return NextResponse.json(
      { error: "Failed to fetch linked expenses" },
      { status: 500 }
    );
  }
}
