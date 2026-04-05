import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Paths that do not require authentication
const publicPaths = ["/api/auth/", "/sw.js", "/manifest.json"];

/**
 * Validate the session token by calling better-auth directly (no HTTP roundtrip).
 * Returns true if the session is valid, false otherwise.
 */
async function validateSession(request: NextRequest): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return !!session?.session && !!session?.user;
  } catch {
    return false;
  }
}

function unauthorizedResponse(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

function applyCsp(response: NextResponse, nonce: string): NextResponse {
  const cspHeader = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");

  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Inject nonce into request headers for downstream use
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icons")
  ) {
    return NextResponse.next();
  }

  // Handle /login: redirect authenticated users away, let unauthenticated through
  if (pathname === "/login") {
    const hasSession = request.cookies.has("better-auth.session_token");
    if (hasSession && (await validateSession(request))) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return applyCsp(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce
    );
  }

  // Allow public paths through regardless of auth state
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for Better Auth session token cookie
  const sessionToken = request.cookies.get("better-auth.session_token")?.value;

  if (!sessionToken) {
    return unauthorizedResponse(request);
  }

  // Validate the session token against better-auth
  const isValid = await validateSession(request);
  if (!isValid) {
    // Clear the invalid cookie and redirect/reject
    const response = unauthorizedResponse(request);
    response.cookies.delete("better-auth.session_token");
    return response;
  }

  return applyCsp(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce
  );
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
