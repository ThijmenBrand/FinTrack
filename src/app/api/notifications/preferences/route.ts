import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { setNotificationPreference } from "@/lib/notifications/preferences";
import { isChannel, isNotificationType } from "@/lib/notifications/registry";

/**
 * PATCH /api/notifications/preferences — one switch: `{ type, channel, enabled }`.
 * `type` and `channel` must be values the registry knows; a locked channel
 * (security email) can't be turned off.
 */
export async function PATCH(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);
    const { type, channel, enabled } = (body ?? {}) as Record<string, unknown>;
    if (!isNotificationType(type) || !isChannel(channel) || typeof enabled !== "boolean") {
      return apiError("api.invalidBody", 400);
    }
    const result = await setNotificationPreference(userId, type, channel, enabled);
    if (result === "unsupported") return apiError("api.invalidBody", 400);
    if (result === "locked") return apiError("api.notificationLocked", 400);
    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    logDataEvent({
      userId,
      action: "notification_preference_update",
      targetType: "notification_preference",
      details: { type, channel, enabled },
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ ok: true });
  }, "Failed to update notification preference");
}
