import { NextRequest, NextResponse } from "next/server";

// Paths that do not require authentication
const publicPaths = ["/api/auth/", "/sw.js", "/manifest.json"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icons")
  ) {
    return NextResponse.next();
  }

  // Allow /login through — the login page handles redirect if already authenticated
  if (pathname === "/login") {
    return NextResponse.next();
  }

  // Allow public paths through regardless of auth state
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Protected routes: check for session cookie existence only.
  // Full session validation is handled by requireAuth() in server components.
  const hasSession = request.cookies.has("better-auth.session_token");

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
