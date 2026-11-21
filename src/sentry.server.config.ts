import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";
import { DATA_COLLECTION } from "@/lib/sentry-data-collection";

// No-op when NEXT_PUBLIC_SENTRY_DSN is unset, like the other optional env vars.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  dataCollection: DATA_COLLECTION,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  // Bank sync handles IBANs, OAuth codes and states, signed tokens and keys;
  // none of it may reach a third-party error tracker through an exception
  // message, a span's URL, a log line or a breadcrumb.
  beforeSend: scrubEvent,
  // Spans stream individually in SDK v11 — there is no transaction event left
  // to scrub, so `beforeSendTransaction` is gone and this covers both the
  // service span and its children.
  beforeSendSpan: scrubEvent,
  beforeSendLog: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});
