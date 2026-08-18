import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
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
      return apiError("api.potNotFound", 404);
    }
    if (pot.targetAmount == null || !pot.targetDate) {
      return apiError("api.potNoTarget", 400);
    }
    // The "cannot remove more than funded" guard lives in the UPDATE's WHERE
    // so concurrent negative allocations can't both pass a stale read check.
    const result = await db
      .update(transactionGroups)
      .set({
        fundedAmount: sql`COALESCE(${transactionGroups.fundedAmount}, 0) + ${delta}`,
      })
      .where(
        and(
          eq(transactionGroups.id, potId),
          eq(transactionGroups.userId, userId),
          sql`COALESCE(${transactionGroups.fundedAmount}, 0) + ${delta} >= 0`
        )
      );
    if (result.rowsAffected === 0) {
      return apiError("api.removeMoreThanFunded", 400);
    }

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

