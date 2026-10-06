import { NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { listDevices } from "@/lib/notifications/devices";
import { getNotificationSettings } from "@/lib/notifications/preferences";
import { vapidConfig } from "@/lib/notifications/push";

/**
 * GET /api/notifications — everything the notification settings page shows:
 * the server's public push key (null = push not set up here), this user's
 * devices, and every notification type with its channel switches.
 */
export async function GET() {
  return withUser(async (userId) => {
    const [settings, devices] = await Promise.all([getNotificationSettings(userId), listDevices(userId)]);
    return NextResponse.json({
      publicKey: vapidConfig()?.publicKey ?? null,
      devices,
      ...settings,
    });
  }, "Failed to fetch notification settings");
}
