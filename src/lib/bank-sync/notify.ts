import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user, userPreferences } from "@/db/schema";
import { sendBankSecurityEmail, type BankSecurityEvent } from "@/lib/email";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Mail the user about a bank-sync event, in their language. Never throws: a
 * mail that can't be sent must not undo or block the action it reports.
 */
export async function notifyBankEvent(
  userId: string,
  event: BankSecurityEvent,
  vars: { bank?: string; date?: string } = {},
): Promise<void> {
  try {
    const [row] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!row?.email) return;
    const [prefs] = await db
      .select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const locale = isLocale(prefs?.locale) ? prefs.locale : DEFAULT_LOCALE;
    await sendBankSecurityEmail(row.email, event, `${appUrl()}/settings/bank-connections`, vars, locale);
  } catch (err) {
    // The error of a mail provider can echo the address; report the event only.
    // (console.error reaches Sentry through its console integration.)
    console.error(`[bank-sync] notification mail failed (${event}):`, err instanceof Error ? err.name : "error");
  }
}
