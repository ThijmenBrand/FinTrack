import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { isInvestmentAccount } from "@/lib/account-kinds";
import { getAccountHoldings, recomputeAccountValuations } from "@/lib/holdings-db";
import { checkTrade } from "@/lib/holdings-input";
import { logDataEvent } from "@/lib/audit";
import { toIsoDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/translate";

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

/**
 * PATCH /api/accounts/[id]/holdings/[tradeId] — correct a trade.
 *
 * Correcting rather than deleting and re-entering, because the common repair
 * is a buy whose price was never filled in: the units and the date are right,
 * only what they cost is missing. Re-entry would mean reading the row, typing
 * it again and hoping nothing was transcribed wrong in between.
 *
 * The instrument stays put. Pointing a trade at a different fund is not a
 * correction — it is two corrections, and it would silently rewrite the cost
 * basis of two holdings at once.
 */
export async function PATCH(
  request: NextRequest,
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
    const [existing] = await db
      .select({
        instrumentId: trades.instrumentId,
        date: trades.date,
        type: trades.type,
        quantity: trades.quantity,
        unitPrice: trades.unitPrice,
        fee: trades.fee,
      })
      .from(trades)
      .where(scope);
    if (!existing) return apiError("api.tradeNotFound", 404);

    const body = (await request.json()) as Record<string, unknown>;
    // Whatever the body leaves out keeps the value it already had, so a
    // caller fixing one field never has to resend the rest correctly.
    const checked = checkTrade(
      {
        instrumentId: existing.instrumentId,
        date: body.date ?? existing.date,
        type: body.type ?? existing.type,
        quantity: body.quantity ?? existing.quantity,
        unitPrice: body.unitPrice ?? existing.unitPrice,
        fee: body.fee ?? existing.fee,
      },
      toIsoDate(new Date()),
    );
    if (!checked.ok) return apiError(checked.error as MessageKey, 400);

    await db.update(trades).set(checked.value).where(scope);
    // The same rebuild a new trade triggers: a corrected price moves the cost
    // basis, the cash beside it and every valuation from that date on.
    await recomputeAccountValuations(db, ownerId, id);

    logDataEvent({
      userId,
      action: "account_update",
      targetId: id,
      targetType: "account",
      details: { tradeUpdated: tradeId },
    });

    return NextResponse.json(await getAccountHoldings(db, ownerId, id));
  }, "Failed to update trade");
}
