import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth, getBaseURL } from "@/lib/auth";
import { getAccountAccess } from "@/lib/account-access";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";
import { getUserPreferences } from "@/lib/preferences";
import { sendShareAcceptedEmail } from "@/lib/email";
import {
  acceptShareInvite,
  findPendingShareInvite,
  type PendingShareInvite,
} from "@/lib/share-invites";

/**
 * Audit the accept and tell the owner. Both are best-effort: the membership is
 * already live, and a failed notification must not turn that into an error.
 */
async function afterAccept(
  invite: PendingShareInvite,
  memberUserId: string,
  memberName: string,
  hdrs: Headers,
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMeta(hdrs);
  await logAuthEvent({
    userId: memberUserId,
    action: "share_invite_accepted",
    details: { accountId: invite.member.accountId, memberId: invite.member.id },
    ipAddress,
    userAgent,
  });

  try {
    const { locale } = await getUserPreferences(invite.ownerId);
    const owner = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, invite.ownerId))
      .get();
    if (owner) {
      await sendShareAcceptedEmail(
        owner.email,
        `${getBaseURL()}/accounts`,
        memberName,
        invite.accountName,
        locale,
      );
    }
  } catch (err) {
    console.error("Share-accepted notification failed:", err);
  }
}

// GET /api/shares/accept?token=X — what the share-invite page needs to render
export async function GET(request: NextRequest) {
  const invite = await findPendingShareInvite(
    new URL(request.url).searchParams.get("token"),
  );
  if (!invite) return apiError("api.inviteLinkInvalid", 410);

  return NextResponse.json({
    accountName: invite.accountName,
    ownerName: invite.ownerName,
    email: invite.member.email,
    role: invite.member.role,
  });
}

// POST /api/shares/accept — accept as the signed-in user. Sharing is invite-only
// for existing users, so this link never creates an account.
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    const invite = await findPendingShareInvite(token);
    if (!invite) return apiError("api.inviteLinkInvalid", 410);

    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session?.user?.id) {
      return apiError("api.signInToAccept", 401);
    }

    const access = await getAccountAccess(session.user.id, invite.member.accountId);
    if (access?.role === "owner") {
      return apiError("api.alreadyOwnAccount", 400);
    }
    if (access) {
      return apiError("api.alreadyHasAccess", 409);
    }

    await acceptShareInvite(invite.member.id, session.user.id);
    await afterAccept(invite, session.user.id, session.user.name || invite.member.email, hdrs);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to accept share invite:", error);
    return apiError("api.inviteAcceptFailed", 500);
  }
}
