import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { describeDevice, deviceKey } from "./device";
import { hasLedgerKeyPrefix, notify, recordSilently } from "./dispatch";
import type { AccountSecurityEvent } from "./registry";

const DEVICE_PREFIX = "security.account:device:";

/**
 * A sign-in, told to the user only when it comes from a kind of device
 * (browser + OS) they never signed in from before. The ledger is the list of
 * known devices; the very first one is recorded without a message, so turning
 * this feature on doesn't greet every existing user with "new sign-in".
 * Never throws.
 */
export async function notifySignIn(userId: string, userAgent: string | null): Promise<void> {
  try {
    const key = `${DEVICE_PREFIX}${deviceKey(userAgent)}`;
    const data = { event: "newDevice" as const, device: describeDevice(userAgent).label };
    if (!(await hasLedgerKeyPrefix(userId, DEVICE_PREFIX))) {
      await recordSilently(userId, "security.account", data, key);
      return;
    }
    await notify(userId, "security.account", data, key);
  } catch (err) {
    console.error("[notifications] sign-in check failed:", err instanceof Error ? err.name : "error");
  }
}

/** Password, two-factor or passkey changed. Every occurrence is news. Never throws. */
export async function notifyAccountChange(userId: string, event: Exclude<AccountSecurityEvent, "newDevice">) {
  await notify(userId, "security.account", { event }, `security.account:${event}:${crypto.randomUUID()}`);
}

/** Whether two-factor is on, read fresh — for spotting the moment it flips. */
export async function twoFactorEnabled(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return !!row?.enabled;
}
