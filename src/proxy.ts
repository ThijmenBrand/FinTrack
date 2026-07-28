import { auth } from "@/lib/auth";
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Paths that do not require authentication
const publicPaths = ["/api/auth/", "/sw.js", "/manifest.json"];

async function validateSession(request: NextRequest): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return !!session?.session && !!session?.user;
  } catch {
    return false;
  }
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

  // Redirect authenticated users away from /login, but allow stale sessions through
  if (pathname === "/login") {
    if (!sessionToken) {
      return NextResponse.next();
    }

    if (await validateSession(request)) {
      return NextResponse.redirect(new URL("/", request.url));
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

  if (!(await validateSession(request))) {
    return clearAuthCookies(unauthorizedResponse(request));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
