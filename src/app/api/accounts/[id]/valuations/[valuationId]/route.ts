import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { isInvestmentAccount } from "@/lib/account-kinds";
import { deleteValuation, listValuations } from "@/lib/valuations";
import { logDataEvent } from "@/lib/audit";

// DELETE /api/accounts/[id]/valuations/[valuationId] — drop one dated figure.
// Deleting the newest one re-derives the account's value from whatever is left,
// or back to "not valued yet" when nothing is.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; valuationId: string }> },
) {
  return withUser(async (userId) => {
    const { id, valuationId } = await params;
    const { account } = await requireAccountAccess(userId, id, "write");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    const removed = await deleteValuation(db, account.userId, id, valuationId);
    if (!removed) return apiError("api.valuationNotFound", 404);

    logDataEvent({
      userId,
      action: "account_update",
      targetId: id,
      targetType: "account",
      details: { valuationDeleted: valuationId },
    });

    return NextResponse.json(await listValuations(db, account.userId, id));
  }, "Failed to delete valuation");
}
