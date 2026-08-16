import * as Sentry from "@sentry/nextjs";

// No-op when NEXT_PUBLIC_SENTRY_DSN is unset, like the other optional env vars.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
});
