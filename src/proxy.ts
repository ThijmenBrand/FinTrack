import { auth } from "@/lib/auth";
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isLockExempt, readLockState, touchSession } from "@/lib/session-lock";
import { SESSION_LOCKED_CODE, unlockPath } from "@/lib/unlock-path";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Paths that do not require authentication
const publicPaths = [
  "/api/auth/",
  "/api/signup-status",
  "/sw.js",
  "/manifest.json",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/api/invites/accept",
  // Share invites are opened from an email, usually signed out. The page keeps
  // the token across the login round trip itself; a middleware redirect to
  // /login would drop it and the invite could never be accepted.
  "/share-invite",
  "/api/shares/accept",
  "/two-factor",
];

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * The session is a sliding window, and better-auth slides it by re-issuing
 * the session cookie. Read it `asResponse` so we can hand that refreshed
 * cookie to the browser — without it the cookie would expire a fixed time
 * after login no matter how active the user is.
 */
async function getValidSession(
  request: NextRequest,
): Promise<{ session: Session | null; setCookies: string[] }> {
  try {
    const response = await auth.api.getSession({
      headers: request.headers,
      asResponse: true,
    });
    const data = (await response.json()) as Session | null;
    return {
      session: data?.session && data?.user ? data : null,
      setCookies: response.headers.getSetCookie(),
    };
  } catch {
    return { session: null, setCookies: [] };
  }
}

function withCookies(response: NextResponse, setCookies: string[]): NextResponse {
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}

function isAdminSession(session: Session): boolean {
  return (session.user as Record<string, unknown>).role === "admin";
}

function hasTwoFactorEnabled(session: Session): boolean {
  return (session.user as Record<string, unknown>).twoFactorEnabled === true;
}

function clearAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete("better-auth.session_token");
  response.cookies.delete("__Secure-better-auth.session_token");
  response.cookies.delete("better-auth.session_data");
  response.cookies.delete("__Secure-better-auth.session_data");
  return response;
}

function unauthorizedResponse(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (pathname.startsWith("/backoffice")) {
    return NextResponse.redirect(new URL("/backoffice/login", request.url));
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

async function sessionLock(session: Session) {
  try {
    return await readLockState(session.session.id);
  } catch {
    // Can't tell whether it is locked — then it is.
    return { locked: true, touch: false };
  }
}

/** API callers get a 401 they can recognise; pages go to the lock screen. */
function lockedResponse(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Session locked", code: SESSION_LOCKED_CODE },
      { status: 401 },
    );
  }
  // A client-side navigation carries the router's cache-buster; the page
  // the user returns to after unlocking shouldn't.
  const params = new URLSearchParams(request.nextUrl.search);
  params.delete("_rsc");
  const query = params.toString();
  const returnTo = query ? `${pathname}?${query}` : pathname;
  return NextResponse.redirect(new URL(unlockPath(returnTo), request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icons") ||
    // The image optimizer refetches these server-side without cookies; a
    // redirect to /login makes it report "not a valid image".
    pathname.startsWith("/banks")
  ) {
    return NextResponse.next();
  }

  const sessionToken = getSessionCookie(request.headers);

  // Redirect authenticated users away from the login pages (admins to the
  // backoffice, everyone else to the app), but allow stale sessions through.
  if (pathname === "/login" || pathname === "/backoffice/login") {
    if (!sessionToken) {
      return NextResponse.next();
    }

    const { session } = await getValidSession(request);
    if (session) {
      return NextResponse.redirect(
        new URL(isAdminSession(session) ? "/backoffice" : "/", request.url),
      );
    }

    return clearAuthCookies(NextResponse.next());
  }

  // Validate the Origin on every mutating API request. better-auth's own
  // handler is excluded — it enforces trustedOrigins itself, and rejecting a
  // missing Origin here would break flows it accepts. /api/auth/profile* are
  // ours, not better-auth's, so they stay in.
  if (
    pathname.startsWith("/api/") &&
    (!pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/auth/profile")) &&
    !SAFE_METHODS.has(request.method)
  ) {
    const csrfError = validateCsrfOrigin(request);
    if (csrfError) return csrfError;
  }

  // Public paths need no session — but one that comes with a cookie still
  // goes past the idle lock below, or a locked session could reach
  // better-auth's account endpoints (add a passkey, list sessions) through
  // the /api/auth/ exemption.
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const lockExempt = isLockExempt(pathname, request.method);
  if (isPublic && (!sessionToken || lockExempt)) {
    return NextResponse.next();
  }

  if (!sessionToken) {
    return unauthorizedResponse(request);
  }

  const { session, setCookies } = await getValidSession(request);
  if (!session) {
    return isPublic
      ? NextResponse.next()
      : clearAuthCookies(unauthorizedResponse(request));
  }

  if (!lockExempt) {
    const lock = await sessionLock(session);
    if (lock.locked) {
      return withCookies(lockedResponse(request), setCookies);
    }
    if (lock.touch) {
      // Losing one activity write only brings the lock a minute closer;
      // it is no reason to fail the request.
      await touchSession(session.session.id, session.user.id).catch(() => {});
    }
  }

  // The lock screen sorts out where to go next itself — the role routing
  // below would bounce a locked admin from /unlock to /backoffice and back.
  if (isPublic || lockExempt) {
    return withCookies(NextResponse.next(), setCookies);
  }

  // Role-based page routing: admins live in /backoffice, regular users in the
  // app. Finance /api/* is not role-blocked — withUser scopes all data by
  // userId, and withAdmin gates the admin API.
  if (!pathname.startsWith("/api/")) {
    const admin = isAdminSession(session);
    if (pathname.startsWith("/backoffice")) {
      if (!admin) {
        return withCookies(NextResponse.redirect(new URL("/", request.url)), setCookies);
      }
      if (!hasTwoFactorEnabled(session) && pathname !== "/backoffice/security") {
        return withCookies(
          NextResponse.redirect(new URL("/backoffice/security", request.url)),
          setCookies,
        );
      }
    } else if (admin) {
      return withCookies(
        NextResponse.redirect(new URL("/backoffice", request.url)),
        setCookies,
      );
    }
  }

  return withCookies(NextResponse.next(), setCookies);
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
