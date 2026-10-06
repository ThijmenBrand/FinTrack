import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { getUserPreferences } from "@/lib/preferences";
import { getI18nFor } from "@/lib/i18n/translate";
import { isAllowedPushEndpoint, sendPush, vapidConfig } from "@/lib/notifications/push";
import { createRateLimiter } from "@/lib/rate-limit";

const allowTest = createRateLimiter(60_000, 5);

/**
 * POST /api/notifications/test — `{ endpoint }`: send a test notification to
 * this browser (one of the user's own registered devices), so they can see
 * what an alert looks like and that delivery works.
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    if (!vapidConfig()) return apiError("api.pushNotConfigured", 400);
    if (!allowTest(userId)) return apiError("api.rateLimitedMessages", 429);
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) return apiError("api.invalidPushSubscription", 400);
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, body.endpoint)));
    if (subscriptions.length === 0) return apiError("api.deviceNotFound", 404);
    const { t } = getI18nFor((await getUserPreferences(userId)).locale);
    const delivered = await sendPush(
      userId,
      subscriptions,
      { title: t("notifications.test.title"), body: t("notifications.test.body"), url: "/settings/notifications", tag: "test" },
      { ttlSeconds: 300 },
    );
    return NextResponse.json({ delivered });
  }, "Failed to send test notification");
}
