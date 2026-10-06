import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { removeDevice } from "@/lib/notifications/devices";

/** DELETE /api/notifications/devices/:id — stop sending to one of the user's devices. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (userId) => {
    const { id } = await params;
    if (!(await removeDevice(userId, id))) return apiError("api.deviceNotFound", 404);
    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    logDataEvent({ userId, action: "push_device_remove", targetId: id, targetType: "push_subscription", ipAddress, userAgent });
    return NextResponse.json({ ok: true });
  }, "Failed to remove device");
}
