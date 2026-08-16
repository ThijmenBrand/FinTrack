# Finance Tracker

A self-hosted personal finance tracker. Import bank transactions from CSV,
auto-categorize them with rules, track budgets, recurring payments, savings
pots, and see spending insights.

Single-user-oriented but multi-user capable (each user gets their own
accounts, categories, and data). Built with Next.js and SQLite/Turso — no
external services required to run it locally.

## Stack

- **Next.js 16** (App Router, React 19) — UI and API routes
- **Drizzle ORM** on **libSQL/SQLite** — local file DB in dev, [Turso](https://turso.tech) in prod
- **better-auth** — email/password, PIN, and passkey login
- **TanStack Query** — client data fetching/caching
- **Tailwind v4 + Radix UI** — styling and components
- **Vitest** — tests

## Quick start

Node 20+ and pnpm. Nothing else — no Docker, no external services.

```bash
pnpm run setup     # deps, .env, database schema, a year of dummy data
pnpm run dev       # http://localhost:3000
```

Then log in:

Sign-in is by **email address**, not username:

| Email | Password | Goes to |
|---|---|---|
| `demo@local.test` | `demo` | the finance app, preloaded with 12 months of dummy data |
| `admin@local.test` | `admin` | `/backoffice` — user management and the audit log |

**Use `demo@local.test` for app work.** Admins are redirected to `/backoffice` and can't
open the finance pages at all (`src/proxy.ts` enforces the split), so logging in
as `admin` looks like the app is broken when it isn't.

The local database is a SQLite file at `data/finance.db` (gitignored). `setup`
is safe to re-run: it won't overwrite an existing `.env`, and it only seeds a
database with no transactions in it (`pnpm run setup -- --seed` forces a reseed).

By hand, if you prefer:

```bash
pnpm install
cp .env.example .env
pnpm run db:migrate   # create/upgrade tables + seed the admin user
pnpm run db:seed      # create the demo user + dummy data
pnpm run dev
```

## Dummy data

`pnpm run db:seed` fills the database with a plausible year of Dutch banking:
three accounts (checking, savings, joint), salary and fixed costs linked to
recurring plans, everyday spending across all default categories, monthly
internal transfers between accounts, category rules, budgets, three pots
(two with savings targets), and a few reimbursed group dinners.

```bash
pnpm run db:seed                      # 12 months for "demo"
pnpm run db:seed -- --months 3        # shorter history
pnpm run db:seed -- --user alice --password hunter2   # a second user, created if missing
pnpm run db:reset                     # delete the DB, migrate, reseed from scratch
```

It's deterministic — the same flags always produce the same numbers, so
screenshots and bug reports line up. Re-running **wipes the target user's
financial data first** so it never stacks up, and it refuses to run when
`TURSO_DATABASE_URL` is set.

> After `db:reset`, restart `pnpm run dev`. The dev server keeps a handle on the
> old database file and will keep serving it (logins start failing) until it is.

## Environment

Copy `.env.example` → `.env`. Everything has a working local default, so an
empty `.env` still runs.

| Variable | Required | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | prod | Session-signing secret, min 32 chars. A dev fallback is used if unset (with a warning); **required in production**. |
| `BETTER_AUTH_URL` | yes | Base URL, e.g. `http://localhost:3000` or your prod domain. Used for auth callbacks — and baked in at *build* time by `src/proxy.ts`. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY_NAME` | no | Seeded on first `db:migrate` only, and only when the database has no users. Default `admin`/`admin`, signing in as `admin@local.test`. |
| `SEED_USERNAME` / `SEED_PASSWORD` / `SEED_EMAIL` | no | Defaults for `db:seed`'s target user. Default `demo`/`demo`, signing in as `demo@local.test`. |
| `RESEND_API_KEY` / `EMAIL_FROM` | prod | Signup verification and password-reset mail. Unset locally → mail contents are logged to the console instead. |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | prod | Leave **unset** for local (uses the SQLite file). Set **both** to use Turso. |

The DB target is chosen at runtime: if `TURSO_DATABASE_URL` is set it uses
Turso, otherwise the local SQLite file. Same switch drives `drizzle.config.ts`.

## Common commands

| Command | Does |
|---|---|
| `pnpm run dev` | Dev server |
| `pnpm run build` | Prod build, then applies migrations |
| `pnpm start` | Serve the production build |
| `pnpm test` | Run Vitest once (`test:watch` for watch mode) |
| `pnpm run lint` | ESLint |
| `pnpm run db:migrate` | Apply pending migrations + seed admin/categories (safe to re-run) |
| `pnpm run db:generate` | Generate a new migration from `src/db/schema.ts` |
| `pnpm run db:seed` | Dummy data for the demo user (see above) |
| `pnpm run db:reset` | Delete the local DB, migrate, reseed |
| `pnpm run db:studio` | Drizzle Studio (browse the DB) |
| `pnpm run db:init` | Seed/repair step only, without migrating |

Schema changes are versioned: edit `src/db/schema.ts`, run `pnpm run db:generate`,
commit the generated `drizzle/*.sql`, then `pnpm run db:migrate`. There is no
`db:push` — pushing was dropped because it silently skips data-loss statements.

`scripts/reset-password.ts` resets a user's password if you get locked out.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Logged in, but every page bounces to `/backoffice` | You're on the `admin` account. Log in as `demo@local.test`. |
| "Invalid email or password" for a user you just seeded | You're using the username — sign in with the full email (`demo@local.test`). Or the dev server is holding the deleted database file; restart it. |
| Empty dashboard | Ran `db:migrate` but not `db:seed`, or you're logged in as a user with no data. |
| `No such table` errors | Missing migrations — run `pnpm run db:migrate`. |

## Deploying

Designed for **Vercel + Turso**, but any Node host works.

1. **Create a Turso database** and grab its URL + auth token
   (`turso db create`, `turso db show`, `turso db tokens create`).
2. **Set env vars** on the host: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
   `BETTER_AUTH_SECRET` (a real 32+ char secret), and `BETTER_AUTH_URL`
   (your production domain).
3. **Deploy.** `pnpm run build` applies pending migrations to Turso and seeds the
   admin user automatically, so the DB is ready on first deploy. On Vercel,
   `BETTER_AUTH_URL` falls back to `VERCEL_PROJECT_PRODUCTION_URL` if unset.
4. **Log in and change the admin password** immediately.

Self-signup is off by default (`app_settings.signups_enabled`, toggled from the
backoffice). Set `RESEND_API_KEY` + `EMAIL_FROM` before enabling it, or
verification emails will fail.

Security headers (HSTS, CSP, X-Frame-Options, etc.) are set in
`next.config.ts` and apply to all routes.

## How it works

```
src/
  app/
    (auth)/login        login page
    (app)/              authenticated app (transactions, budgets, insights, …)
    api/                route handlers — the backend
  db/                   schema.ts (Drizzle tables), migrate.ts (seed/init), index.ts (client)
  lib/                  auth, validation, csv-utils, audit, business logic
  lib/i18n/             locales, message catalogues, client/server translators
  components/           UI (ui/ = Radix/shadcn primitives)
  hooks/                TanStack Query data hooks
```

- **Auth**: `src/lib/auth.ts` configures better-auth (username/password, PIN,
  passkey). Passwords use scrypt. Sessions are cookie-based. `(app)` routes are
  gated behind a logged-in session.
- **Data**: All persistence goes through Drizzle. The DB client
  (`src/db/index.ts`) is lazily constructed so importing a module for a pure
  helper doesn't open a connection. **All queries are parameterized** — see
  `CLAUDE.md` for the SQL-safety rules this repo enforces.
- **Backend**: API route handlers under `src/app/api/*` do the work
  (transactions, categorize, upload/commit, budgets, pots, recurring,
  insights, admin). The client calls them via hooks in `src/hooks`.
- **Language**: English and Dutch, picked in Settings → General and stored on
  `user_preferences.locale` (mirrored into a `locale` cookie so the login and
  invite pages match). Client components read `useI18n()` from
  `src/lib/i18n/client`; server components `await getI18n()` from
  `src/lib/i18n/server`. Both hand back `t()`, `plural()` and locale-bound
  date/currency formatters. Message keys are flat and dotted in
  `src/lib/i18n/messages/en.ts`; `nl.ts` is typed against it, so a missing
  translation is a build error.

### What you can do

- **Accounts** — track multiple bank accounts.
- **Import** — upload a bank CSV; a review step lets you map columns and
  confirm before committing. Imports are grouped into batches (see Import
  History) so they can be reviewed/undone.
- **Categories & rules** — categorize transactions; rules auto-assign
  categories by matching patterns (validated, max 200 chars).
- **Budgets** — set per-category budgets and track spend against them.
- **Recurring** — detect and link recurring payments; feeds "Free to Spend".
- **Pots** — savings buckets you allocate money into.
- **Reimbursements** — link a transaction to the expense it pays you back for.
- **Insights** — spending breakdowns, budget performance, balance over time.
- **Admin** — user management and an audit log of auth/admin events.

## Testing

```bash
pnpm test
```

Vitest, config in `vitest.config.ts`. CI runs `pnpm test` on every PR and on
pushes to `main` (`.github/workflows/test.yml`).
