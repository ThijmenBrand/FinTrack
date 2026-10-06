import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { parseSubscription, removeDeviceByEndpoint, saveSubscription } from "@/lib/notifications/devices";
import { isAllowedPushEndpoint, vapidConfig } from "@/lib/notifications/push";

/**
 * POST /api/notifications/devices — register this browser's push
 * subscription (the body is `PushSubscription.toJSON()`). The endpoint must
 * belong to a known push service: the server will POST to it.
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    if (!vapidConfig()) return apiError("api.pushNotConfigured", 400);
    const input = parseSubscription(await request.json().catch(() => null));
    if (!input) return apiError("api.invalidPushSubscription", 400);
    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    const { id, created } = await saveSubscription(userId, input, userAgent);
    if (created) {
      logDataEvent({ userId, action: "push_device_add", targetId: id, targetType: "push_subscription", ipAddress, userAgent });
    }
    return NextResponse.json({ id }, { status: created ? 201 : 200 });
  }, "Failed to register device");
}

/**
 * DELETE /api/notifications/devices — `{ endpoint }`: "turn off on this
 * device", and the sign-out cleanup, which only know the browser's endpoint.
 */
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) return apiError("api.invalidPushSubscription", 400);
    const removed = await removeDeviceByEndpoint(userId, body.endpoint);
    if (removed) {
      const { ipAddress, userAgent } = getRequestMeta(request.headers);
      logDataEvent({ userId, action: "push_device_remove", targetType: "push_subscription", ipAddress, userAgent });
    }
    return NextResponse.json({ removed });
  }, "Failed to remove device");
}
