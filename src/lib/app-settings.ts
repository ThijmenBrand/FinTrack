import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const SIGNUPS_KEY = "signups_enabled";

/** Missing row = disabled: signups are opt-in from the backoffice. */
export async function getSignupsEnabled(): Promise<boolean> {
  const row = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SIGNUPS_KEY))
    .get();
  return row?.value === "true";
}

export async function setSignupsEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SIGNUPS_KEY, value: String(enabled) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: String(enabled), updatedAt: new Date().toISOString() },
    });
}
