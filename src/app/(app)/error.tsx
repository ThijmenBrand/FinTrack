"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

/**
 * Without this file a single client-side render error anywhere in the app
 * escapes to Next's built-in global error page: a blank document, no sidebar,
 * no way back, and no clue what broke. This keeps the app shell and shows the
 * message, so a crash is both recoverable and reportable.
 *
 * The raw message stays behind a disclosure. Unfolded it is still the failing
 * SQL or stack — exactly what you want when reporting it — but a person who
 * just wanted to see their budget shouldn't be handed a query to read.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    Sentry.captureException(error);
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{t("error.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("error.body")}</p>

      <Button className="mt-6" onClick={reset}>
        {t("common.retry")}
      </Button>

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="mt-6 inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("error.showDetails")}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", showDetails && "rotate-180")}
        />
      </button>
      {showDetails && (
        <p className="mt-3 max-w-xl rounded-lg bg-muted p-3 text-left font-mono text-xs break-words text-muted-foreground">
          {error.message}
          {error.digest && ` (${error.digest})`}
        </p>
      )}
    </div>
  );
}
