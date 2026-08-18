import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { headers } from "next/headers";
import { and, desc, eq, isNull, gt } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { withAdmin, getBaseURL, type SessionData } from "@/lib/auth";
import { validateEmail, validateName } from "@/lib/validation";
import {
  hashInviteToken,
  inviteExpiry,
  inviteStatus,
  newInviteToken,
} from "@/lib/invites";
import { sendInviteEmail } from "@/lib/email";
import { logAudit, getRequestMeta } from "@/lib/audit";
import { getUserPreferences } from "@/lib/preferences";
import type { Locale } from "@/lib/i18n";

// `lang` makes the accept page render in the inviter's language before the
// invitee has any preference of their own.
function inviteUrl(token: string, locale: Locale): string {
  return `${getBaseURL()}/invite?token=${token}&lang=${locale}`;
}

async function logInviteAction(
  adminId: string,
  action: string,
  inviteId: string,
  details?: Record<string, unknown>,
) {
  const { ipAddress, userAgent } = getRequestMeta(await headers());
  await logAudit({
    userId: adminId,
    category: "admin",
    action,
    targetId: inviteId,
    targetType: "invite",
    details,
    ipAddress,
    userAgent,
  });
}

/**
 * Send the invite mail, keeping the row so "Resend" can retry a failed send.
 * Name and language both follow the original inviter — the accept page shows
 * their name, so a resend by another admin must not say someone else invited
 * you (or mix languages).
 */
async function deliver(
  email: string,
  token: string,
  session: SessionData,
  inviterId: string = session.userId,
): Promise<NextResponse | null> {
  try {
    const { locale } = await getUserPreferences(inviterId);
    const inviter = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, inviterId))
      .get();
    await sendInviteEmail(
      email,
      inviteUrl(token, locale),
      inviter?.name ?? session.displayName,
      locale,
    );
    return null;
  } catch (err) {
    console.error("Invite email failed to send:", err);
    return apiError("api.inviteEmailFailedAdmin", 502);
  }
}

// GET /api/admin/invites — list every invite, newest first
export async function GET() {
  return withAdmin(async () => {
    const rows = await db.select().from(invites).orderBy(desc(invites.createdAt));
    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        isAdmin: row.role === "admin",
        status: inviteStatus(row),
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        acceptedAt: row.acceptedAt,
      })),
    );
  }, "Failed to fetch invites");
}

// POST /api/admin/invites — create an invite and email the link
export async function POST(request: NextRequest) {
  return withAdmin(async (session) => {
    const { email, displayName, isAdmin } = await request.json();

    const emailError = validateEmail(email);
    if (emailError) {
      return NextResponse.json({ error: emailError }, { status: 400 });
    }
    const cleanEmail = (email as string).trim().toLowerCase();

    let cleanDisplayName: string | null = null;
    if (displayName !== undefined && displayName !== null && displayName !== "") {
      const check = validateName(displayName);
      if (!check.ok) {
        return apiError(check.error, 400, check.vars);
      }
      cleanDisplayName = check.value;
    }

    const existingUser = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, cleanEmail))
      .get();
    if (existingUser) {
      return apiError("api.emailHasAccount", 409);
    }

    const pending = await db
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.email, cleanEmail),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date().toISOString()),
        ),
      )
      .get();
    if (pending) {
      return apiError("api.alreadyInvitedPending", 409);
    }

    const token = newInviteToken();
    const [row] = await db
      .insert(invites)
      .values({
        email: cleanEmail,
        tokenHash: hashInviteToken(token),
        role: isAdmin ? "admin" : "user",
        displayName: cleanDisplayName,
        invitedBy: session.userId,
        expiresAt: inviteExpiry(),
      })
      .returning({ id: invites.id });

    await logInviteAction(session.userId, "invite_sent", row.id, {
      email: cleanEmail,
      isAdmin: !!isAdmin,
    });

    const failure = await deliver(cleanEmail, token, session);
    if (failure) return failure;

    return NextResponse.json({ id: row.id, email: cleanEmail }, { status: 201 });
  }, "Failed to create invite");
}

// PUT /api/admin/invites — resend, rotating the token so the old link dies
export async function PUT(request: NextRequest) {
  return withAdmin(async (session) => {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Invite ID is required" }, { status: 400 });
    }

    const invite = await db.select().from(invites).where(eq(invites.id, id)).get();
    if (!invite) {
      return apiError("api.inviteNotFound", 404);
    }
    const status = inviteStatus(invite);
    if (status === "accepted" || status === "revoked") {
      return apiError("api.cannotResendInvite", 409);
    }

    const token = newInviteToken();
    await db
      .update(invites)
      .set({ tokenHash: hashInviteToken(token), expiresAt: inviteExpiry() })
      .where(eq(invites.id, id));

    await logInviteAction(session.userId, "invite_resent", id, {
      email: invite.email,
    });

    const failure = await deliver(invite.email, token, session, invite.invitedBy ?? undefined);
    if (failure) return failure;

    return NextResponse.json({ success: true });
  }, "Failed to resend invite");
}

// DELETE /api/admin/invites?id=X — revoke, killing the outstanding link
export async function DELETE(request: NextRequest) {
  return withAdmin(async (session) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Invite ID is required" }, { status: 400 });
    }

    const revoked = await db
      .update(invites)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(invites.id, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .returning({ email: invites.email });

    if (revoked.length === 0) {
      return apiError("api.inviteNotPending", 409);
    }

    await logInviteAction(session.userId, "invite_revoked", id, {
      email: revoked[0].email,
    });

    return NextResponse.json({ success: true });
  }, "Failed to revoke invite");
}
