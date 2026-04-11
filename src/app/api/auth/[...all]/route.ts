import { auth, verifyPassword } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/index";
import { account } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { headers } from "next/headers";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";

const { GET: _GET, POST: _POST } = toNextJsHandler(auth);

const BLOCKED_PATHS = ["/sign-up"];

function isBlocked(req: NextRequest): boolean {
  const url = new URL(req.url);
  return BLOCKED_PATHS.some((p) => url.pathname.endsWith(p));
}

/**
 * Require password re-authentication before deleting a passkey.
 * Expects { id: string, currentPassword: string } in the request body.
 */
async function handleDeletePasskey(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { currentPassword, id } = body;

  if (!currentPassword) {
    return NextResponse.json(
      { error: "Current password is required to delete a passkey" },
      { status: 400 },
    );
  }

  if (!id) {
    return NextResponse.json(
      { error: "Passkey ID is required" },
      { status: 400 },
    );
  }

  // Verify current password
  const userAccount = await db
    .select()
    .from(account)
    .where(
      and(
        eq(account.userId, session.user.id),
        eq(account.providerId, "credential"),
      ),
    )
    .get();

  if (!userAccount?.password) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const passwordValid = await verifyPassword(currentPassword, userAccount.password);
  if (!passwordValid) {
    return NextResponse.json({ error: "Invalid password" }, { status: 403 });
  }

  // Password verified — forward to better-auth's delete handler
  // Reconstruct the request without currentPassword in the body
  const forwardReq = new NextRequest(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ id }),
  });

  return _POST(forwardReq);
}

export function GET(req: NextRequest) {
  if (isBlocked(req)) {
    return NextResponse.json(
      { error: "Sign-up is disabled" },
      { status: 403 },
    );
  }
  return _GET(req);
}

export async function POST(req: NextRequest) {
  if (isBlocked(req)) {
    return NextResponse.json(
      { error: "Sign-up is disabled" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  if (url.pathname.endsWith("/passkey/delete-passkey")) {
    return handleDeletePasskey(req);
  }

  const { ipAddress, userAgent } = getRequestMeta(req.headers);

  // Intercept sign-in attempts to log failures
  if (url.pathname.endsWith("/sign-in/email")) {
    const clonedReq = req.clone();
    const response = await _POST(req);
    if (!response.ok) {
      try {
        const body = await clonedReq.json();
        logAuthEvent({
          userId: null,
          action: "login_failure",
          details: { username: body.username || null },
          ipAddress,
          userAgent,
        });
      } catch { /* body already consumed or missing */ }
    }
    return response;
  }

  // Log passkey authentication
  if (url.pathname.endsWith("/passkey/authenticate")) {
    const response = await _POST(req);
    logAuthEvent({
      userId: null,
      action: response.ok ? "passkey_auth_success" : "passkey_auth_failure",
      ipAddress,
      userAgent,
    });
    return response;
  }

  // Log logout
  if (url.pathname.endsWith("/sign-out")) {
    const session = await auth.api.getSession({ headers: await headers() });
    logAuthEvent({
      userId: session?.user?.id || null,
      action: "logout",
      ipAddress,
      userAgent,
    });
    return _POST(req);
  }

  return _POST(req);
}
