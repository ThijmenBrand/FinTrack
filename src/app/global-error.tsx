"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { getI18nFor } from "@/lib/i18n/translate";

/**
 * Last-resort boundary for crashes outside the (app) group (root layout, auth
 * pages). Renders its own <html> without providers or global CSS, so the
 * styling is inline and the locale comes off the cookie rather than context.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // This boundary is also rendered on the server, where there is no
  // `document` — and a throw in here has nothing left to catch it.
  const cookie =
    typeof document === "undefined"
      ? undefined
      : document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))?.[1];
  const locale = isLocale(cookie) ? cookie : DEFAULT_LOCALE;
  const { t } = getI18nFor(locale);

  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui", textAlign: "center", padding: "4rem 1rem" }}>
        <h1>{t("error.title")}</h1>
        <p>
          {error.message}
          {error.digest && ` (${error.digest})`}
        </p>
        <button onClick={reset}>{t("common.retry")}</button>
      </body>
    </html>
  );
}
