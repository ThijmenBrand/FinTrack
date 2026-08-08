import { NextResponse } from "next/server";
import { getSignupsEnabled } from "@/lib/app-settings";

// GET /api/signup-status — public: tells the login/signup pages whether
// self-signup is currently open (backoffice toggle).
export async function GET() {
  try {
    return NextResponse.json({ enabled: await getSignupsEnabled() });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
