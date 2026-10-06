import { createHash } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { describeDevice } from "./device";
import { isAllowedPushEndpoint, isPushKey } from "./push";

/** Devices per user; adding one more replaces the one registered longest ago. */
export const MAX_DEVICES = 10;

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What `PushSubscription.toJSON()` posts, checked: a known push service and well-formed keys. */
export function parseSubscription(body: unknown): SubscriptionInput | null {
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!b || !isAllowedPushEndpoint(b.endpoint)) return null;
  if (!isPushKey(b.keys?.p256dh, 200) || !isPushKey(b.keys?.auth, 100)) return null;
  return { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth };
}

export interface DeviceView {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  /**
   * SHA-256 of the endpoint, so the page can spot "this device" (it hashes
   * its own) without the API handing every endpoint back out.
   */
  endpointHash: string;
}

export function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function listDevices(userId: string): Promise<DeviceView[]> {
  const rows = await db
    .select({
      id: pushSubscriptions.id,
      label: pushSubscriptions.label,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
      endpoint: pushSubscriptions.endpoint,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    // rowid breaks ties: two registrations in the same millisecond still have an order.
    .orderBy(asc(pushSubscriptions.createdAt), asc(sql`rowid`));
  return rows.map(({ endpoint, ...row }) => ({ ...row, endpointHash: hashEndpoint(endpoint) }));
}

/**
 * Register this browser for the user. An endpoint is one browser profile, so
 * if another account signed in on it before, it moves to this one — the
 * browser proving it holds the endpoint is what makes that safe, and
 * notifications must follow whoever uses the device now.
 */
export async function saveSubscription(
  userId: string,
  input: SubscriptionInput,
  userAgent: string | null,
): Promise<{ id: string; created: boolean }> {
  const label = describeDevice(userAgent).label;
  const [existing] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, userId)))
    .limit(1);
  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh: input.p256dh, auth: input.auth, label, failureCount: 0 })
      .where(and(eq(pushSubscriptions.id, existing.id), eq(pushSubscriptions.userId, userId)));
    return { id: existing.id, created: false };
  }

  // The same browser, previously registered by another account on it.
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, input.endpoint), ne(pushSubscriptions.userId, userId)));

  const devices = await listDevices(userId);
  for (const old of devices.slice(0, Math.max(0, devices.length - MAX_DEVICES + 1))) {
    await removeDevice(userId, old.id);
  }

  const [row] = await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, label })
    .returning({ id: pushSubscriptions.id });
  return { id: row.id, created: true };
}

/** True when a row of this user's was removed. */
export async function removeDevice(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function removeDeviceByEndpoint(userId: string, endpoint: string): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}
