import { DEFAULT_LOCALE, type Locale } from ".";
import { getI18nFor, type I18n } from "./translate";

/**
 * The active translator, reachable without a hook.
 *
 * Some of what the app says to the user is decided outside the component
 * tree — a mutation that fails in the query cache, a gesture bound once in an
 * effect. Those need wording in the user's language without a React context
 * to read it from, so `I18nProvider` publishes the locale here on mount and
 * this is where they pick it up.
 *
 * Components must keep using `useI18n()`: this is for the places that have no
 * other way in.
 */
let active: I18n = getI18nFor(DEFAULT_LOCALE);

export function setActiveLocale(locale: Locale) {
  active = getI18nFor(locale);
}

export function activeI18n(): I18n {
  return active;
}
