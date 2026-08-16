"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

/**
 * Without this file a single client-side render error anywhere in the app
 * escapes to Next's built-in global error page: a blank document, no sidebar,
 * no way back, and no clue what broke. This keeps the app shell and shows the
 * message, so a crash is both recoverable and reportable.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    Sentry.captureException(error);
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">{t("error.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("error.body")}</p>
      <p className="mx-auto mt-4 max-w-xl font-mono text-xs break-words text-muted-foreground">
        {error.message}
        {error.digest && ` (${error.digest})`}
      </p>
      <Button className="mt-6" onClick={reset}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
