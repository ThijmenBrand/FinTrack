import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { sanitizeNote } from "@/lib/validation";

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

    const clean = sanitizeNote(notes);
    const result = await db
      .update(transactions)
      .set({ notes: clean })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, notes: clean });
  }, "Failed to update notes");
}
