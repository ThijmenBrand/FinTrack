/**
 * Locale primitives. Deliberately free of React and of the message
 * dictionaries so schema/API/edge code can import it without pulling in the
 * translations.
 */
export const LOCALES = ["en", "nl"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Shown in the language picker — always in the language itself. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  nl: "Nederlands",
};

/** BCP-47 tag handed to Intl. "en" means European English, hence en-GB. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  nl: "nl-NL",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Cookie mirroring the stored preference, so logged-out pages render right. */
export const LOCALE_COOKIE = "locale";

/** Best-effort match of an Accept-Language header against LOCALES. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    const base = tag?.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}
