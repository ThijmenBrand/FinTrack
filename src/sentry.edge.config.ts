import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  // See sentry.server.config.ts.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendSpan: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});
