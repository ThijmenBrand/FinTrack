import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accountMembers } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { logDataEvent } from "@/lib/audit";
import { isShareRole, ownedAccountIds } from "@/lib/share-invites";

type Params = { params: Promise<{ id: string; memberId: string }> };

/** One live row of an account the caller owns — the only thing either verb may touch. */
function liveMemberOfOwned(memberId: string, accountId: string, ownerId: string) {
  return and(
    eq(accountMembers.id, memberId),
    eq(accountMembers.accountId, accountId),
    inArray(accountMembers.accountId, ownedAccountIds(ownerId)),
    isNull(accountMembers.revokedAt),
  );
}

// PATCH /api/accounts/[id]/members/[memberId] — change viewer/editor
export async function PATCH(request: NextRequest, { params }: Params) {
  return withUser(async (ownerId) => {
    const { id, memberId } = await params;
    await requireAccountAccess(ownerId, id, "manage");

    const { role } = await request.json();
    if (!isShareRole(role)) {
      return apiError("api.invalidRole", 400);
    }

    const updated = await db
      .update(accountMembers)
      .set({ role })
      .where(liveMemberOfOwned(memberId, id, ownerId))
      .returning({ email: accountMembers.email });
    if (updated.length === 0) {
      return apiError("api.memberNotFound", 404);
    }

    logDataEvent({
      userId: ownerId,
      action: "share_role_changed",
      targetId: memberId,
      targetType: "account_member",
      details: { accountId: id, email: updated[0].email, role },
    });

    return NextResponse.json({ success: true });
  }, "Failed to update member");
}

// DELETE /api/accounts/[id]/members/[memberId] — revoke access. The row stays,
// so the members list keeps its history and the partial unique index frees the
// address for a fresh invite.
export async function DELETE(_request: NextRequest, { params }: Params) {
  return withUser(async (ownerId) => {
    const { id, memberId } = await params;
    await requireAccountAccess(ownerId, id, "manage");

    const revoked = await db
      .update(accountMembers)
      .set({ revokedAt: new Date().toISOString() })
      .where(liveMemberOfOwned(memberId, id, ownerId))
      .returning({ email: accountMembers.email });
    if (revoked.length === 0) {
      return apiError("api.memberNotFound", 404);
    }

    logDataEvent({
      userId: ownerId,
      action: "share_revoked",
      targetId: memberId,
      targetType: "account_member",
      details: { accountId: id, email: revoked[0].email },
    });

    return NextResponse.json({ success: true });
  }, "Failed to remove member");
}
