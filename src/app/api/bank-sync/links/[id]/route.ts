import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccountLinks } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { defaultSyncFrom, latestDates } from "@/lib/bank-sync/status";
import { withStepUp } from "@/lib/step-up";

/**
 * PATCH /api/bank-sync/links/:id  { accountId }  (step-up)
 * Feed a bank account into a different FinTrack account. The new target
 * starts the day after its own newest row, like a fresh link.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStepUp(async ({ userId }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { accountId?: unknown } | null;
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";

    const [link] = await db
      .select()
      .from(bankAccountLinks)
      .where(and(eq(bankAccountLinks.id, id), eq(bankAccountLinks.userId, userId)))
      .limit(1);
    if (!link) return apiError("api.bankNotFound", 404);
    if (link.accountId === accountId) return NextResponse.json({ ok: true });

    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1);
    if (!account) return apiError("api.bankMappingInvalid", 400);
    const [taken] = await db
      .select({ id: bankAccountLinks.id })
      .from(bankAccountLinks)
      .where(and(eq(bankAccountLinks.accountId, accountId), eq(bankAccountLinks.userId, userId)))
      .limit(1);
    if (taken) return apiError("api.bankAccountAlreadyLinked", 409);

    const latest = (await latestDates([accountId], userId)).get(accountId);
    await db
      .update(bankAccountLinks)
      .set({
        accountId,
        syncFrom: defaultSyncFrom(latest),
        lastBookedDate: null,
        lastSyncedAt: null,
        bankBalance: null,
        bankBalanceAt: null,
        lastErrorCode: null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(bankAccountLinks.id, link.id), eq(bankAccountLinks.userId, userId)));
    logDataEvent({
      userId,
      action: "bank_link_retargeted",
      targetId: link.id,
      targetType: "bank_account_link",
      details: { from: link.accountId, to: accountId },
      ...getRequestMeta(request.headers),
    });
    return NextResponse.json({ ok: true });
  }, "Failed to change bank link");
}

/**
 * DELETE /api/bank-sync/links/:id  (step-up)
 * Stop feeding one account; the connection and its other links stay.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStepUp(async ({ userId }) => {
    const { id } = await params;
    const [link] = await db
      .delete(bankAccountLinks)
      .where(and(eq(bankAccountLinks.id, id), eq(bankAccountLinks.userId, userId)))
      .returning({ id: bankAccountLinks.id, accountId: bankAccountLinks.accountId });
    if (!link) return apiError("api.bankNotFound", 404);
    logDataEvent({
      userId,
      action: "bank_link_removed",
      targetId: link.id,
      targetType: "bank_account_link",
      details: { accountId: link.accountId },
      ...getRequestMeta(request.headers),
    });
    return NextResponse.json({ ok: true });
  }, "Failed to remove bank link");
}
