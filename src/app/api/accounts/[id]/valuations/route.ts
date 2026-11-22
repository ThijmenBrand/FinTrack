import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { isInvestmentAccount } from "@/lib/account-kinds";
import { isFiniteNumber, isIsoDate } from "@/lib/validation";
import { listValuations, recordValuation } from "@/lib/valuations";
import { logDataEvent } from "@/lib/audit";
import { toIsoDate } from "@/lib/utils";

// GET /api/accounts/[id]/valuations — the account's value history, newest first.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(userId, id, "read");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    return NextResponse.json(await listValuations(db, account.userId, id));
  }, "Failed to fetch valuations");
}

// POST /api/accounts/[id]/valuations — record what the account was worth on a
// date. A second figure for the same date replaces the first; in practice a
// repeat entry is a correction, and two values for one day would make the
// series ambiguous.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(userId, id, "write");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    const { value, date } = await request.json();
    if (!isFiniteNumber(value) || !isIsoDate(date)) {
      return apiError("api.invalidValuation", 400);
    }
    // A figure dated in the future would claim to know what a market has not
    // done yet, and would sit at the end of the series as today's value.
    if (date > toIsoDate(new Date())) return apiError("api.valuationInFuture", 400);
    // Negative would mean the broker owes nothing and then some; a portfolio
    // bottoms out at nothing. A debt belongs on a credit account.
    if (value < 0) return apiError("api.invalidValuation", 400);

    await recordValuation(db, {
      ownerId: account.userId,
      accountId: id,
      date,
      value,
    });

    logDataEvent({
      userId,
      action: "account_update",
      targetId: id,
      targetType: "account",
      details: { valuation: date },
    });

    return NextResponse.json(await listValuations(db, account.userId, id), {
      status: 201,
    });
  }, "Failed to record valuation");
}
