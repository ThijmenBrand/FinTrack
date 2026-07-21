import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactionGroups } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent, getRequestMeta } from "@/lib/audit";

// POST /api/pots/allocate — increment fundedAmount on a targeted pot.
// Body: { potId: string; amount: number }
// `amount` may be negative to undo an over-allocation.
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const { potId, amount } = await request.json();

    if (!potId) {
      return NextResponse.json({ error: "potId is required" }, { status: 400 });
    }
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json(
        { error: "amount must be a non-zero number" },
        { status: 400 }
      );
    }

    const pot = await db
      .select({
        id: transactionGroups.id,
        targetAmount: transactionGroups.targetAmount,
        targetDate: transactionGroups.targetDate,
        fundedAmount: transactionGroups.fundedAmount,
      })
      .from(transactionGroups)
      .where(
        and(eq(transactionGroups.id, potId), eq(transactionGroups.userId, userId))
      )
      .get();

    if (!pot) {
      return NextResponse.json({ error: "Pot not found" }, { status: 404 });
    }
    if (pot.targetAmount == null || !pot.targetDate) {
      return NextResponse.json(
        { error: "Pot has no target — set targetAmount and targetDate first" },
        { status: 400 }
      );
    }
    if (delta < 0 && Math.abs(delta) > (pot.fundedAmount ?? 0)) {
      return NextResponse.json(
        { error: "Cannot remove more than is funded" },
        { status: 400 }
      );
    }

    await db
      .update(transactionGroups)
      .set({
        fundedAmount: sql`MAX(0, COALESCE(${transactionGroups.fundedAmount}, 0) + ${delta})`,
      })
      .where(
        and(eq(transactionGroups.id, potId), eq(transactionGroups.userId, userId))
      );

    const updated = await db
      .select({ fundedAmount: transactionGroups.fundedAmount })
      .from(transactionGroups)
      .where(
        and(eq(transactionGroups.id, potId), eq(transactionGroups.userId, userId))
      )
      .get();
    const nextFunded = updated?.fundedAmount ?? 0;

    const meta = getRequestMeta(request.headers);
    await logDataEvent({
      userId,
      action: "pot.allocate",
      targetId: potId,
      targetType: "pot",
      details: { delta, fundedAmount: nextFunded, targetAmount: pot.targetAmount },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return NextResponse.json({ success: true, fundedAmount: nextFunded });
  }, "Failed to allocate to pot");
}

