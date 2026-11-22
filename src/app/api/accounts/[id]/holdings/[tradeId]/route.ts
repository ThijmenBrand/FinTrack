import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { isInvestmentAccount } from "@/lib/account-kinds";
import { getAccountHoldings, recomputeAccountValuations } from "@/lib/holdings-db";
import { logDataEvent } from "@/lib/audit";

/**
 * DELETE /api/accounts/[id]/holdings/[tradeId] — remove a trade.
 *
 * Positions are derived, so deleting a trade rewrites every figure that
 * followed it: the average price of what is still held, what later sales
 * realized, and the whole valuation history. That recompute is the point —
 * correcting a mistyped buy from last year should not leave last year's chart
 * showing the old numbers.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  return withUser(async (userId) => {
    const { id, tradeId } = await params;
    const { account } = await requireAccountAccess(userId, id, "write");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    const ownerId = account.userId;
    const scope = and(
      eq(trades.id, tradeId),
      eq(trades.accountId, id),
      eq(trades.userId, ownerId),
    );
    const [existing] = await db.select({ id: trades.id }).from(trades).where(scope);
    if (!existing) return apiError("api.tradeNotFound", 404);

    await db.delete(trades).where(scope);
    await recomputeAccountValuations(db, ownerId, id);

    logDataEvent({
      userId,
      action: "account_update",
      targetId: id,
      targetType: "account",
      details: { tradeDeleted: tradeId },
    });

    return NextResponse.json(await getAccountHoldings(db, ownerId, id));
  }, "Failed to delete trade");
}
