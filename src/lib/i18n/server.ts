import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { DEFAULT_LOCALE, isLocale, type Locale } from ".";
import { getRequestLocale } from "./request";
import { getI18nFor, type I18n } from "./translate";

/**
 * Resolves the active locale for the current request, in order:
 * the signed-in user's stored preference, the cookie the settings page
 * mirrors it into (this is what logged-out pages get), then Accept-Language.
 *
 * `cache()` keeps it to one session lookup + one query per request, however
 * many server components ask for it.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      const prefs = await getUserPreferences(session.user.id);
      if (isLocale(prefs.locale)) return prefs.locale;
    }
  } catch {
    // Unauthenticated or pre-migration DB — fall through to the cookie.
  }

  return getRequestLocale();
});

export { getRequestLocale };

/**
 * Translator + locale-bound formatters for server components.
 *
 * Falls back to the default locale when there is no request scope at all —
 * data-layer helpers that label rows are also exercised straight from tests.
 */
export async function getI18n(): Promise<I18n> {
  try {
    return getI18nFor(await getLocale());
  } catch {
    return getI18nFor(DEFAULT_LOCALE);
  }
}
