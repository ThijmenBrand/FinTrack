import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";

const { GET: _GET, POST: _POST } = toNextJsHandler(auth);

const BLOCKED_PATHS = ["/sign-up"];

function isBlocked(req: NextRequest): boolean {
  const url = new URL(req.url);
  return BLOCKED_PATHS.some((p) => url.pathname.endsWith(p));
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

export function POST(req: NextRequest) {
  if (isBlocked(req)) {
    return NextResponse.json(
      { error: "Sign-up is disabled" },
      { status: 403 },
    );
  }
  return _POST(req);
}
