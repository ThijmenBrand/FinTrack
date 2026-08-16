import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accountMembers, user } from "@/db/schema";
import { withUser, getBaseURL } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { validateEmail } from "@/lib/validation";
import { hashInviteToken, inviteExpiry, inviteStatus, newInviteToken } from "@/lib/invites";
import { sendShareInviteEmail } from "@/lib/email";
import { logDataEvent } from "@/lib/audit";
import { getUserPreferences } from "@/lib/preferences";
import {
  countLiveMembers,
  isShareRole,
  isUniqueViolation,
  MAX_MEMBERS_PER_ACCOUNT,
} from "@/lib/share-invites";

// GET /api/accounts/[id]/members — the owner plus everyone invited, so the UI
// can render one list. Any member may look: sharing is not a secret from the
// people you share with.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(userId, id, "read");

    const rows = await db
      .select({ member: accountMembers, memberName: user.name })
      .from(accountMembers)
      .leftJoin(user, eq(user.id, accountMembers.userId))
      .where(and(eq(accountMembers.accountId, id), isNull(accountMembers.revokedAt)))
      .orderBy(accountMembers.createdAt);

    const owner = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, account.userId))
      .get();

    return NextResponse.json([
      {
        id: account.userId,
        email: owner?.email ?? null,
        role: "owner",
        status: "accepted",
        memberName: owner?.name ?? null,
        createdAt: account.createdAt,
      },
      ...rows.map(({ member, memberName }) => ({
        id: member.id,
        email: member.email,
        role: member.role,
        status: inviteStatus({ ...member, expiresAt: member.expiresAt ?? "" }),
        memberName: member.acceptedAt ? memberName : null,
        createdAt: member.createdAt,
        // The caller's own row. Matching by email would miss invites accepted
        // under a different address than the one invited.
        isMe: member.userId === userId,
      })),
    ]);
  }, "Failed to fetch members");
}

// POST /api/accounts/[id]/members — invite someone to this account
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (ownerId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(ownerId, id, "manage");

    const { email, role } = await request.json();
    const emailError = validateEmail(email);
    if (emailError) {
      return NextResponse.json({ error: emailError }, { status: 400 });
    }
    if (!isShareRole(role)) {
      return NextResponse.json(
        { error: "Role must be viewer or editor" },
        { status: 400 },
      );
    }
    const cleanEmail = (email as string).trim().toLowerCase();

    const owner = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, ownerId))
      .get();
    if (owner && owner.email.toLowerCase() === cleanEmail) {
      return NextResponse.json({ error: "You already own this account" }, { status: 400 });
    }

    if ((await countLiveMembers(id, ownerId)) >= MAX_MEMBERS_PER_ACCOUNT) {
      return NextResponse.json(
        { error: `An account can be shared with at most ${MAX_MEMBERS_PER_ACCOUNT} people` },
        { status: 400 },
      );
    }

    const token = newInviteToken();
    let memberId: string;
    try {
      const [row] = await db
        .insert(accountMembers)
        .values({
          accountId: id,
          // Explicit null: the member is unknown until accept, and naming
          // user_id keeps the INSERT past the tenant guard.
          userId: null,
          email: cleanEmail,
          role,
          tokenHash: hashInviteToken(token),
          expiresAt: inviteExpiry(),
        })
        .returning({ id: accountMembers.id });
      memberId = row.id;
    } catch (err) {
      // Partial unique index on (account_id, email) WHERE revoked_at IS NULL.
      if (isUniqueViolation(err)) {
        return NextResponse.json(
          { error: "That address is already invited to this account" },
          { status: 409 },
        );
      }
      throw err;
    }

    logDataEvent({
      userId: ownerId,
      action: "share_invite_sent",
      targetId: memberId,
      targetType: "account_member",
      details: { accountId: id, email: cleanEmail, role },
    });

    // The invite goes out in the owner's language — same rule as admin invites.
    const { locale } = await getUserPreferences(ownerId);
    try {
      await sendShareInviteEmail(
        cleanEmail,
        `${getBaseURL()}/share-invite?token=${token}&lang=${locale}`,
        owner?.name ?? "",
        account.name,
        locale,
      );
    } catch (err) {
      // Keep the row — the owner can revoke it and invite again.
      console.error("Share invite email failed to send:", err);
      return NextResponse.json(
        { error: "Invite saved, but the email failed to send. Remove it and invite again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ id: memberId, email: cleanEmail, role }, { status: 201 });
  }, "Failed to invite member");
}
