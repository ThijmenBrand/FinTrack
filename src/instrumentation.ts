import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Bank sync: the master key belongs to the worker container only.
    const { assertWebHasNoBankKey } = await import("./lib/bank-sync/process-guard");
    assertWebHasNoBankKey();

    // Self-hosted (Docker): apply pending migrations once at server start,
    // before the first request is served. On Vercel `pnpm build` still does
    // this, so the flag is only set in the container.
    if (process.env.RUN_MIGRATIONS_ON_START === "1") {
      const { runMigrations } = await import("./db/run-migrations");
      await runMigrations();
      console.log("Migrations applied and database initialized.");
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
