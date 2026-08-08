import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserAccount } from "@/lib/create-user";
import { hashInviteToken, inviteStatus } from "@/lib/invites";
import { validateName, validatePassword } from "@/lib/validation";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";

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

const GONE = { error: "This invite link is no longer valid" };

// GET /api/invites/accept?token=X — what the accept page needs to render
export async function GET(request: NextRequest) {
  const invite = await findPendingInvite(
    new URL(request.url).searchParams.get("token"),
  );
  if (!invite) return NextResponse.json(GONE, { status: 410 });

  return NextResponse.json({
    email: invite.email,
    displayName: invite.displayName,
  });
}

// POST /api/invites/accept — create the account and sign the new user in
export async function POST(request: NextRequest) {
  try {
    const { token, username, displayName, password } = await request.json();

    const invite = await findPendingInvite(token);
    if (!invite) return NextResponse.json(GONE, { status: 410 });

    const usernameCheck = validateName(username);
    if (!usernameCheck.ok) {
      return NextResponse.json(
        { error: `Invalid username: ${usernameCheck.error}` },
        { status: 400 },
      );
    }
    const displayCheck = validateName(displayName ?? invite.displayName);
    if (!displayCheck.ok) {
      return NextResponse.json(
        { error: `Invalid display name: ${displayCheck.error}` },
        { status: 400 },
      );
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // The invite link proved the mailbox, so the account starts verified.
    const userId = await createUserAccount({
      email: invite.email,
      username: usernameCheck.value,
      displayName: displayCheck.value,
      password,
      isAdmin: invite.role === "admin",
      emailVerified: true,
    });
    if (!userId) {
      return NextResponse.json(
        { error: "That username is already taken" },
        { status: 409 },
      );
    }

    await db
      .update(invites)
      .set({ acceptedAt: new Date().toISOString(), acceptedUserId: userId })
      .where(eq(invites.id, invite.id));

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
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}
