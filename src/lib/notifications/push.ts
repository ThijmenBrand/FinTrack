import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { db } from "@/db";
import { pushSubscriptions, type PushSubscription } from "@/db/schema";

/**
 * Web Push delivery (VAPID, RFC 8291 payload encryption via `web-push`). The
 * push service only ever sees ciphertext; the browser decrypts and shows it.
 *
 * Configured by VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT, in both
 * the web app (security events, test pushes) and the worker (everything it
 * evaluates). Without them push is simply off and the settings page says so.
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost";
  return { publicKey, privateKey, subject };
}

/**
 * The push services browsers actually hand out. The server POSTs to whatever
 * endpoint a browser registered, so anything else — an internal address, a
 * metadata service — is refused before it is stored or called.
 */
const PUSH_HOSTS: (string | RegExp)[] = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung, Opera
  /^jmt\d+\.google\.com$/, // Chrome's newer FCM endpoints
  "updates.push.services.mozilla.com", // Firefox
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  "web.push.apple.com", // Safari, iOS home-screen apps
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge on Windows
];

export const MAX_ENDPOINT_LENGTH = 1024;

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (typeof h === "string" ? h === host : h.test(host)));
}

/** base64url, as PushSubscription.toJSON() gives the keys. */
export function isPushKey(v: unknown, maxLength: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLength && /^[A-Za-z0-9_-]+=*$/.test(v);
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushOptions {
  ttlSeconds: number;
  urgency?: "very-low" | "low" | "normal" | "high";
}

/** Drop a subscription after this many failed sends in a row. */
const MAX_FAILURES = 5;
const SEND_TIMEOUT_MS = 10_000;

/**
 * Send one message to every given subscription of one user. Returns how many
 * devices accepted it. Gone subscriptions (404/410) are deleted; others that
 * keep failing are dropped after a few tries. Never throws.
 */
export async function sendPush(
  userId: string,
  subscriptions: PushSubscription[],
  payload: PushPayload,
  opts: PushOptions,
): Promise<number> {
  const vapid = vapidConfig();
  if (!vapid || subscriptions.length === 0) return 0;
  const body = JSON.stringify(payload);
  // Lets the push service replace a still-undelivered older message with the
  // same tag. Topics are at most 32 URL-safe characters.
  const topic = createHash("sha256").update(payload.tag).digest("base64url").slice(0, 32);

  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      // Re-checked at send time: a row stored under an older, looser rule
      // must not become a way to make the server call somewhere else.
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        await deleteSubscription(userId, sub.id);
        return false;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          {
            vapidDetails: vapid,
            TTL: opts.ttlSeconds,
            urgency: opts.urgency ?? "normal",
            topic,
            timeout: SEND_TIMEOUT_MS,
          },
        );
        await db
          .update(pushSubscriptions)
          .set({ failureCount: 0, lastSuccessAt: new Date().toISOString() })
          .where(and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.userId, userId)));
        return true;
      } catch (err) {
        const status = err instanceof WebPushError ? err.statusCode : null;
        if (status === 404 || status === 410 || sub.failureCount + 1 >= MAX_FAILURES) {
          await deleteSubscription(userId, sub.id);
        } else {
          await db
            .update(pushSubscriptions)
            .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
            .where(and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.userId, userId)));
        }
        // Status only: the endpoint is a per-device capability URL.
        console.error(`[push] send failed (${status ?? (err instanceof Error ? err.name : "error")})`);
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}

export async function listSubscriptions(userId: string): Promise<PushSubscription[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

async function deleteSubscription(userId: string, id: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)));
}
