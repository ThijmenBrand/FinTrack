import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";
import { DATA_COLLECTION } from "@/lib/sentry-data-collection";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  dataCollection: DATA_COLLECTION,
  // Most of this app's logging is `console.error` in client components, so
  // without this the Sentry Logs view stays empty however much the browser
  // complains. SDK v11 sends logs by default, so the `enableLogs` opt-in that
  // used to sit here is gone — the console integration is still needed.
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  // The bank callback lands with a one-time code and state in its URL, and
  // pageload traces record URLs before the page can wipe them. Everything
  // that leaves for Sentry goes through the same scrubber as the server's.
  beforeSend: scrubEvent,
  beforeSendSpan: scrubEvent,
  beforeSendLog: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
