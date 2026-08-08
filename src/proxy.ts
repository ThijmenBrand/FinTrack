import { auth } from "@/lib/auth";
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";

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
  "/two-factor",
];

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

async function getValidSession(request: NextRequest): Promise<Session | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.session && session?.user ? session : null;
  } catch {
    return null;
  }
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

    const session = await getValidSession(request);
    if (session) {
      return NextResponse.redirect(
        new URL(isAdminSession(session) ? "/backoffice" : "/", request.url),
      );
    }

    return clearAuthCookies(NextResponse.next());
  }

  // Validate the Origin on every mutating API request. /api/auth/ is excluded:
  // better-auth enforces its own trustedOrigins and the PIN routes call
  // validateCsrfOrigin themselves.
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    !SAFE_METHODS.has(request.method)
  ) {
    const csrfError = validateCsrfOrigin(request);
    if (csrfError) return csrfError;
  }

  // Allow public paths through regardless of auth state
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!sessionToken) {
    return unauthorizedResponse(request);
  }

  const session = await getValidSession(request);
  if (!session) {
    return clearAuthCookies(unauthorizedResponse(request));
  }

  // Role-based page routing: admins live in /backoffice, regular users in the
  // app. Finance /api/* is not role-blocked — withUser scopes all data by
  // userId, and withAdmin gates the admin API.
  if (!pathname.startsWith("/api/")) {
    const admin = isAdminSession(session);
    if (pathname.startsWith("/backoffice")) {
      if (!admin) {
        return NextResponse.redirect(new URL("/", request.url));
      }
      if (!hasTwoFactorEnabled(session) && pathname !== "/backoffice/security") {
        return NextResponse.redirect(new URL("/backoffice/security", request.url));
      }
    } else if (admin) {
      return NextResponse.redirect(new URL("/backoffice", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
