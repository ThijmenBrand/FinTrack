import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  // Most of this app's logging is `console.error` in client components, so
  // without these two the Sentry Logs view stays empty however much the
  // browser complains. `enableLogs` alone isn't enough — the console
  // integration reads it at setup and does nothing when it is unset.
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  // The bank callback lands with a one-time code and state in its URL, and
  // pageload traces record URLs before the page can wipe them. Everything
  // that leaves for Sentry goes through the same scrubber as the server's.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendSpan: scrubEvent,
  beforeSendLog: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
