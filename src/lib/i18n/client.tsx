"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, type Locale } from ".";
import { getI18nFor, type I18n } from "./translate";

const I18nContext = createContext<I18n>(getI18nFor(DEFAULT_LOCALE));

/**
 * The locale is resolved once per request on the server (from the user's
 * stored preference) and handed down, so there is no flash of English before
 * the preferences query resolves.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={getI18nFor(locale)}>{children}</I18nContext.Provider>;
}

/** Translator + locale-bound formatters for client components. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
