import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// POST /api/pots/transactions — add transaction to pot
export async function POST(request: NextRequest) {
  try {
    const { potId, transactionId } = await request.json();
    if (!potId || !transactionId) {
      return NextResponse.json(
        { error: "potId and transactionId are required" },
        { status: 400 }
      );
    }

    await db
      .update(transactions)
      .set({ groupId: potId })
      .where(eq(transactions.id, transactionId));

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
          eq(transactions.groupId, potId)
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
