import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/bank-sync/scrub";

// No-op when NEXT_PUBLIC_SENTRY_DSN is unset, like the other optional env vars.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  // Bank sync handles IBANs, OAuth codes and states, signed tokens and keys;
  // none of it may reach a third-party error tracker through an exception
  // message, a span's URL, a log line or a breadcrumb.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendSpan: scrubEvent,
  beforeSendLog: scrubEvent,
  beforeBreadcrumb: scrubEvent,
});
