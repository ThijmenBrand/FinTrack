import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accountMembers } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";

// DELETE /api/shares/[id] — leave an account someone shared with you. Only the
// caller's own active membership matches, so owners get a natural 404: they
// have no membership row to give up.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;

    const left = await db
      .update(accountMembers)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(accountMembers.id, id),
          eq(accountMembers.userId, userId),
          isNotNull(accountMembers.acceptedAt),
          isNull(accountMembers.revokedAt),
        ),
      )
      .returning({ accountId: accountMembers.accountId });
    if (left.length === 0) {
      return apiError("api.shareNotFound", 404);
    }

    logDataEvent({
      userId,
      action: "share_left",
      targetId: id,
      targetType: "account_member",
      details: { accountId: left[0].accountId },
    });

    return NextResponse.json({ success: true });
  }, "Failed to leave shared account");
}
