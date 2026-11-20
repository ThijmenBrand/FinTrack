import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";
import { DATA_COLLECTION } from "@/lib/sentry-data-collection";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  dataCollection: DATA_COLLECTION,
  // See sentry.server.config.ts. Logs are on by default in SDK v11, but the
  // edge runtime still needs its own console integration.
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  beforeSend: scrubEvent,
  beforeSendSpan: scrubEvent,
  beforeSendLog: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});
