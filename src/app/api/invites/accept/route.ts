import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invites, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserAccount } from "@/lib/create-user";
import { hashInviteToken, inviteStatus } from "@/lib/invites";
import { validateName, validatePassword } from "@/lib/validation";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";
import { getUserPreferences, updateUserPreferences } from "@/lib/preferences";

// ponytail: no rate limit — the token is 256 random bits, so guessing is not a
// threat. Add one here if the route ever accepts a guessable identifier.
async function findPendingInvite(token: unknown) {
  if (typeof token !== "string" || !token) return null;
  const invite = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashInviteToken(token)))
    .get();
  if (!invite || inviteStatus(invite) !== "pending") return null;
  return invite;
}

// GET /api/invites/accept?token=X — what the accept page needs to render
export async function GET(request: NextRequest) {
  const invite = await findPendingInvite(
    new URL(request.url).searchParams.get("token"),
  );
  if (!invite) return apiError("api.inviteLinkInvalid", 410);

  const inviter = invite.invitedBy
    ? await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, invite.invitedBy))
        .get()
    : null;

  return NextResponse.json({
    email: invite.email,
    displayName: invite.displayName,
    invitedBy: inviter?.name ?? null,
  });
}

// POST /api/invites/accept — create the account and sign the new user in
export async function POST(request: NextRequest) {
  try {
    const { token, displayName, password } = await request.json();

    const invite = await findPendingInvite(token);
    if (!invite) return apiError("api.inviteLinkInvalid", 410);

    const displayCheck = validateName(displayName ?? invite.displayName);
    if (!displayCheck.ok) {
      return apiError(displayCheck.error, 400, displayCheck.vars);
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Start the new account in the inviter's language — they can change it in
    // settings. Derived server-side, so the ?lang= in the link can't set it.
    const locale = invite.invitedBy
      ? (await getUserPreferences(invite.invitedBy)).locale
      : undefined;

    // The invite link proved the mailbox, so the account starts verified.
    const userId = await createUserAccount({
      email: invite.email,
      displayName: displayCheck.value,
      password,
      isAdmin: invite.role === "admin",
      emailVerified: true,
      locale,
    });
    if (!userId) {
      return apiError("api.emailRegistered", 409);
    }

    // Best-effort from here on: the account exists, so a failed bookkeeping
    // write must not turn the response into a 500 — a retry would hit the
    // email-uniqueness check and strand the user with an account they don't
    // know about. Single-use stays enforced by that same uniqueness check.
    try {
      await db
        .update(invites)
        .set({ acceptedAt: new Date().toISOString(), acceptedUserId: userId })
        .where(eq(invites.id, invite.id));

      if (locale) await updateUserPreferences(userId, { locale });
    } catch (err) {
      console.error("Invite bookkeeping failed after account creation:", err);
    }

    const hdrs = await headers();
    const { ipAddress, userAgent } = getRequestMeta(hdrs);
    await logAuthEvent({
      userId,
      action: "invite_accepted",
      details: { email: invite.email, inviteId: invite.id },
      ipAddress,
      userAgent,
    });

    try {
      return await auth.api.signInEmail({
        body: { email: invite.email, password },
        headers: hdrs,
        asResponse: true,
      });
    } catch (err) {
      // The account exists either way — let the client fall back to /login.
      console.error("Auto sign-in after invite accept failed:", err);
      return NextResponse.json({ signedIn: false }, { status: 201 });
    }
  } catch (error) {
    console.error("Failed to accept invite:", error);
    return apiError("api.inviteAcceptFailed", 500);
  }
}
