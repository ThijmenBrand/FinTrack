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
- **better-auth** — username/password, PIN, and passkey login
- **TanStack Query** — client data fetching/caching
- **Tailwind v4 + Radix UI** — styling and components
- **Vitest** — tests

## Quick start

```bash
npm run setup     # installs deps, copies .env, pushes schema, seeds DB
npm run dev       # http://localhost:3000
```

Log in with **admin / admin** (change this — see Environment).

`setup` is idempotent-ish: it won't overwrite an existing `.env`. If you'd
rather do it by hand:

```bash
npm install
cp .env.example .env
mkdir -p data
npm run db:push      # create tables (drizzle-kit push)
npm run db:init      # seed admin user + default categories
npm run dev
```

The local database is a SQLite file at `data/finance.db` (gitignored).

## Environment

Copy `.env.example` → `.env`. Variables:

| Variable | Required | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | prod | Session-signing secret, min 32 chars. A dev fallback is used if unset (with a warning); **required in production**. |
| `BETTER_AUTH_URL` | yes | Base URL, e.g. `http://localhost:3000` or your prod domain. Used for auth callbacks. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY_NAME` | no | Seeded on first `db:init` only. Default `admin`/`admin`. |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | prod | Leave **unset** for local (uses the SQLite file). Set **both** to use Turso. |

The DB target is chosen at runtime: if `TURSO_DATABASE_URL` is set it uses
Turso, otherwise the local SQLite file. Same switch drives `drizzle.config.ts`.

## Common commands

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Prod build → `drizzle-kit push` → `db:init` (schema + seed run at build time) |
| `npm start` | Serve the production build |
| `npm test` | Run Vitest once (`test:watch` for watch mode) |
| `npm run lint` | ESLint |
| `npm run db:studio` | Drizzle Studio (browse the DB) |
| `npm run db:push` | Sync schema to the DB |
| `npm run db:init` | Seed admin user + default categories (safe to re-run) |

`scripts/reset-password.ts` resets a user's password if you get locked out.

## Deploying

Designed for **Vercel + Turso**, but any Node host works.

1. **Create a Turso database** and grab its URL + auth token
   (`turso db create`, `turso db show`, `turso db tokens create`).
2. **Set env vars** on the host: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
   `BETTER_AUTH_SECRET` (a real 32+ char secret), and `BETTER_AUTH_URL`
   (your production domain).
3. **Deploy.** `npm run build` pushes the schema to Turso and seeds the admin
   user automatically, so the DB is ready on first deploy. On Vercel,
   `BETTER_AUTH_URL` falls back to `VERCEL_PROJECT_PRODUCTION_URL` if unset.
4. **Log in and change the admin password** immediately.

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
npm test
```

Vitest, config in `vitest.config.ts`. CI runs `npm test` on every PR and on
pushes to `main` (`.github/workflows/test.yml`).
