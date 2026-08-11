import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, transactionGroups } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { touchAllLedgers } from "@/lib/budget-jobs";

// POST /api/pots/transactions — add transaction to pot
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const { potId, transactionId } = await request.json();
    if (!potId || !transactionId) {
      return NextResponse.json(
        { error: "potId and transactionId are required" },
        { status: 400 }
      );
    }

    // Verify the pot belongs to the current user
    const pot = await db
      .select({ id: transactionGroups.id })
      .from(transactionGroups)
      .where(and(eq(transactionGroups.id, potId), eq(transactionGroups.userId, userId)))
      .get();

    if (!pot) {
      return NextResponse.json({ error: "Pot not found" }, { status: 404 });
    }

    await db
      .update(transactions)
      .set({ groupId: potId })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));

    // Spend moves from its own category to the pot's.
    await touchAllLedgers(userId);

    return NextResponse.json({ success: true });
  }, "Failed to add transaction to pot");
}

// DELETE /api/pots/transactions?potId=X&transactionId=Y — remove transaction from pot
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const potId = searchParams.get("potId");
    const transactionId = searchParams.get("transactionId");

    if (!potId || !transactionId) {
      return NextResponse.json(
        { error: "potId and transactionId are required" },
        { status: 400 }
      );
    }

    await db
      .update(transactions)
      .set({ groupId: null })
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.groupId, potId),
          eq(transactions.userId, userId)
        )
      );

    // …and back again when it leaves the pot.
    await touchAllLedgers(userId);

    return NextResponse.json({ success: true });
  }, "Failed to remove transaction from pot");
}
