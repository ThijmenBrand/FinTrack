import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { notifyBankEvent } from "@/lib/bank-sync/notify";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";
import { withStepUp } from "@/lib/step-up";

/**
 * DELETE /api/bank-sync/connections/:id  (step-up)
 * Disconnect a bank: the worker ends the consent at the bank, then forgets
 * the connection and its links. Imported transactions stay.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStepUp(async ({ userId }) => {
    const { id } = await params;
    const [connection] = await db
      .select({ id: bankConnections.id, aspspName: bankConnections.aspspName })
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, userId)))
      .limit(1);
    if (!connection) return apiError("api.bankNotFound", 404);
    const requestId = await enqueueJob(userId, "bank.revoke_session", { connectionId: connection.id }, {
      priority: JOB_PRIORITY.interactive,
      dedupeKey: `revoke:${connection.id}`,
    });
    logDataEvent({
      userId,
      action: "bank_disconnect_requested",
      targetId: connection.id,
      targetType: "bank_connection",
      details: { aspsp: connection.aspspName },
      ...getRequestMeta(request.headers),
    });
    await notifyBankEvent(userId, "bankDisconnected", { bank: connection.aspspName });
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to disconnect bank");
}
