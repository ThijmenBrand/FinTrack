# syntax=docker/dockerfile:1
# FinTrack: Next.js standalone build, SQLite (libSQL local file) in /app/data.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app

# --- dependencies ---------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build ----------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public/build-time Sentry settings (not secret). NEXT_PUBLIC_* is inlined into the client bundle.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT
# `next build` directly instead of `pnpm build`: that script also migrates the DB,
# which happens at container start here. The auth secret is only needed so
# src/lib/auth.ts can be evaluated during the build; the real one comes from
# app.env at runtime. SENTRY_AUTH_TOKEN is a BuildKit secret, never stored in a layer.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    BETTER_AUTH_SECRET=build-time-placeholder-never-used-at-runtime-000000 \
    pnpm exec next build
# The bank-sync worker: one ESM file, run by the same image as a second
# container (`node dist/worker.mjs`). Only @libsql/client stays external — it
# loads a native binary, and the standalone output already ships it.
RUN pnpm run worker:build

# --- runtime --------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    RUN_MIGRATIONS_ON_START=1

# App files stay root-owned: the "node" user can read but never modify the code.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist/worker.mjs ./dist/worker.mjs
# Mount point for the SQLite database (src/db uses <cwd>/data/finance.db)
RUN install -d -o node -g node -m 700 /app/data

USER 1000:1000
EXPOSE 3000
# /api/signup-status is public and touches the database: a good liveness signal.
# (The worker service overrides this — see deploy/docker-compose.example.yml.)
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/signup-status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
