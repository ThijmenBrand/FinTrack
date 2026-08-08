import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth";
import { getSignupsEnabled, setSignupsEnabled } from "@/lib/app-settings";
import { logAudit, getRequestMeta } from "@/lib/audit";
import { headers } from "next/headers";

// GET /api/admin/settings — read app settings
export async function GET() {
  return withAdmin(async () => {
    return NextResponse.json({ signupsEnabled: await getSignupsEnabled() });
  }, "Failed to fetch settings");
}

// PUT /api/admin/settings — update app settings
export async function PUT(request: NextRequest) {
  return withAdmin(async (session) => {
    const { signupsEnabled } = await request.json();
    if (typeof signupsEnabled !== "boolean") {
      return NextResponse.json(
        { error: "signupsEnabled must be a boolean" },
        { status: 400 }
      );
    }

    await setSignupsEnabled(signupsEnabled);

    const { ipAddress, userAgent } = getRequestMeta(await headers());
    await logAudit({
      userId: session.userId,
      category: "admin",
      action: "settings_change",
      details: { signupsEnabled },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ signupsEnabled });
  }, "Failed to update settings");
}
