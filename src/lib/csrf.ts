import { NextRequest, NextResponse } from "next/server";

/**
 * Validate the Origin header against trusted origins to prevent CSRF.
 * Returns a 403 response if the origin is missing or untrusted, or null if valid.
 */
export function validateCsrfOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");

  // Browsers always send Origin on cross-origin POST/DELETE requests.
  // A missing Origin on a same-origin request is acceptable only if
  // the Sec-Fetch-Site header confirms it (modern browsers).
  if (!origin) {
    const secFetchSite = req.headers.get("sec-fetch-site");
    // "same-origin" or "none" (direct navigation / same-origin JS) are safe.
    // If the header is absent (old browser), reject to be safe.
    if (secFetchSite === "same-origin" || secFetchSite === "none") {
      return null;
    }
    return NextResponse.json(
      { error: "Forbidden: missing origin" },
      { status: 403 },
    );
  }

  const trustedOrigins = getTrustedOrigins();

  if (!trustedOrigins.includes(origin)) {
    return NextResponse.json(
      { error: "Forbidden: untrusted origin" },
      { status: 403 },
    );
  }

  return null;
}

function getTrustedOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.BETTER_AUTH_URL) {
    origins.push(new URL(process.env.BETTER_AUTH_URL).origin);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }
  if (origins.length === 0) {
    origins.push("http://localhost:3000");
  }

  return origins;
}
