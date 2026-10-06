"use client";

/**
 * Browser side of Web Push: is it possible here, what does this browser have,
 * and the subscribe / unsubscribe dance with the service worker. The server
 * half lives in src/lib/notifications.
 */

export type PushSupport = "supported" | "unsupported" | "ios-install";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iPhone and iPad only offer push to a web app opened from the Home Screen —
 * in a Safari tab the APIs aren't there at all, so say how to get it.
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (ios && !isStandalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return "supported";
}

/** This browser's push subscription, if it has one (never registers anything). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Ask for permission and subscribe with the server's key. Must run from a
 * click (iOS refuses otherwise). Returns null when the user said no.
 */
export async function subscribe(publicKey: string): Promise<PushSubscription | null> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  // Production registers the worker on load; development doesn't, so the
  // first subscribe registers it here.
  const registration =
    (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) };
  try {
    return await registration.pushManager.subscribe(options);
  } catch (err) {
    // Subscribed before under another server key (keys were rotated): start over.
    const existing = await registration.pushManager.getSubscription();
    if (!existing) throw err;
    await existing.unsubscribe();
    return registration.pushManager.subscribe(options);
  }
}

/** SHA-256 hex of an endpoint — matches the server's `endpointHash`. */
export async function hashEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<Response> {
  return fetch("/api/notifications/devices", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function registerSubscription(subscription: PushSubscription): Promise<Response> {
  return send("POST", subscription.toJSON());
}

/**
 * Stop this browser receiving the signed-in user's notifications: forget it on
 * the server (while the session still exists), then unsubscribe locally.
 * Used for "turn off" and on sign-out — a shared computer must not keep
 * showing someone's finances. Never throws.
 */
export async function unsubscribeThisDevice(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await send("DELETE", { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Nothing to undo: at worst the server drops the endpoint on its next 410.
  }
}
