import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, transactionGroups } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

// POST /api/pots/transactions — add transaction to pot
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to add transaction to pot:", error);
    return NextResponse.json(
      { error: "Failed to add transaction to pot" },
      { status: 500 }
    );
  }
}

// DELETE /api/pots/transactions?potId=X&transactionId=Y — remove transaction from pot
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId();
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove transaction from pot:", error);
    return NextResponse.json(
      { error: "Failed to remove transaction from pot" },
      { status: 500 }
    );
  }
}
