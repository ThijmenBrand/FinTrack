import { NextResponse } from "next/server";
import { getRequestLocale } from "@/lib/i18n/request";
import { getI18nFor, type I18n, type MessageKey, type Vars } from "@/lib/i18n/translate";

/**
 * Translator bound to the requester's locale.
 *
 * Route handlers read the locale from the cookie the settings page mirrors the
 * stored preference into, so this stays free of the session + preferences
 * lookup `getI18n()` does — an error path should not cost two queries.
 */
export async function requestI18n(): Promise<I18n> {
  return getI18nFor(await getRequestLocale());
}

/**
 * Error JSON in the requester's language. `error` is what the UI shows: most
 * dialogs render `err.message` straight from the response, so the copy has to
 * arrive translated rather than as an English string the client re-maps.
 */
export async function apiError(
  key: MessageKey,
  status: number,
  vars?: Vars,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  const { t } = await requestI18n();
  return NextResponse.json({ error: t(key, vars), ...extra }, { status });
}
