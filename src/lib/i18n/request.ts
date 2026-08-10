import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from ".";

/**
 * Locale from the request alone — cookie, then Accept-Language. For code that
 * runs before (or during) account creation, where there is no stored
 * preference yet and a session lookup would be circular.
 *
 * Kept out of `server.ts` so it doesn't drag in `@/lib/auth` — auth's signup
 * hook needs this.
 */
export async function getRequestLocale(): Promise<Locale> {
  try {
    const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(cookie)) return cookie;
    return localeFromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
