import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth, getBaseURL } from "@/lib/auth";
import { getAccountAccess } from "@/lib/account-access";
import { createUserAccount } from "@/lib/create-user";
import { validateName, validatePassword } from "@/lib/validation";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";
import { getUserPreferences, updateUserPreferences } from "@/lib/preferences";
import { sendShareAcceptedEmail } from "@/lib/email";
import {
  acceptShareInvite,
  findPendingShareInvite,
  type PendingShareInvite,
} from "@/lib/share-invites";

const GONE = { error: "This invite link is no longer valid" };

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
  if (!invite) return NextResponse.json(GONE, { status: 410 });

  // Decides whether the page asks for a password or just a confirmation.
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, invite.member.email))
    .get();

  return NextResponse.json({
    accountName: invite.accountName,
    ownerName: invite.ownerName,
    email: invite.member.email,
    role: invite.member.role,
    userExists: !!existing,
  });
}

// POST /api/shares/accept — accept as the signed-in user, or sign up first
export async function POST(request: NextRequest) {
  try {
    const { token, name, password } = await request.json();

    const invite = await findPendingShareInvite(token);
    if (!invite) return NextResponse.json(GONE, { status: 410 });

    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });

    if (session?.user?.id) {
      const access = await getAccountAccess(session.user.id, invite.member.accountId);
      if (access?.role === "owner") {
        return NextResponse.json(
          { error: "You already own this account" },
          { status: 400 },
        );
      }
      if (access) {
        return NextResponse.json(
          { error: "You already have access to this account" },
          { status: 409 },
        );
      }

      await acceptShareInvite(invite.member.id, session.user.id);
      await afterAccept(invite, session.user.id, session.user.name || invite.member.email, hdrs);
      return NextResponse.json({ ok: true });
    }

    // No session: the invitee still needs an account. Bypasses the signups gate
    // by creating the user directly — the invite is the authorization.
    const nameCheck = validateName(name);
    if (!nameCheck.ok) {
      return NextResponse.json(
        { error: `Invalid name: ${nameCheck.error}` },
        { status: 400 },
      );
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Start the new account in the owner's language — they can change it in
    // settings. Derived server-side, so the ?lang= in the link can't set it.
    const { locale } = await getUserPreferences(invite.ownerId);

    // The invite link proved the mailbox, so the account starts verified.
    const userId = await createUserAccount({
      email: invite.member.email,
      displayName: nameCheck.value,
      password,
      emailVerified: true,
      locale,
    });
    if (!userId) {
      return NextResponse.json(
        { error: "That email is already registered — sign in first, then open this link again" },
        { status: 409 },
      );
    }

    // Best-effort from here on: the account exists, so a failed bookkeeping
    // write must not turn the response into a 500 — a retry would hit the
    // email-uniqueness check and strand the user with an account they don't
    // know about. Single-use stays enforced by that same uniqueness check.
    try {
      await acceptShareInvite(invite.member.id, userId);
      await updateUserPreferences(userId, { locale });
    } catch (err) {
      console.error("Share bookkeeping failed after account creation:", err);
    }

    await afterAccept(invite, userId, nameCheck.value, hdrs);

    try {
      return await auth.api.signInEmail({
        body: { email: invite.member.email, password },
        headers: hdrs,
        asResponse: true,
      });
    } catch (err) {
      // The account exists either way — let the client fall back to /login.
      console.error("Auto sign-in after share accept failed:", err);
      return NextResponse.json({ ok: true, signedIn: false }, { status: 201 });
    }
  } catch (error) {
    console.error("Failed to accept share invite:", error);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}
