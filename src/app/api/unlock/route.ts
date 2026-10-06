import { NextResponse } from "next/server";
import { withSession } from "@/lib/auth";
import { readLockState } from "@/lib/session-lock";

/**
 * GET /api/unlock — is this session locked? Asked by the app when it comes
 * back to the foreground. Lock-exempt, so asking doesn't count as activity.
 */
export async function GET() {
  return withSession(async (ids) => {
    const { locked } = await readLockState(ids.sessionId);
    return NextResponse.json({ locked });
  }, "Failed to read lock state");
}
