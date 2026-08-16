"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort boundary for crashes outside the (app) group (root layout, auth
 * pages). Renders its own <html> without providers or global CSS, so the copy
 * is hardcoded and the styling inline.
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

  return (
    <html>
      <body style={{ fontFamily: "system-ui", textAlign: "center", padding: "4rem 1rem" }}>
        <h1>Something went wrong</h1>
        <p>
          {error.message}
          {error.digest && ` (${error.digest})`}
        </p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
