import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  // The bank callback lands with a one-time code and state in its URL, and
  // pageload traces record URLs before the page can wipe them. Everything
  // that leaves for Sentry goes through the same scrubber as the server's.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendSpan: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
