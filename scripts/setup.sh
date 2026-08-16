#!/usr/bin/env bash
# One-shot local setup: deps, .env, database schema, and dummy data.
# Safe to re-run — it never overwrites an existing .env, and skips seeding
# if the database already has transactions (pass --seed to force a reseed).
set -euo pipefail

cd "$(dirname "$0")/.."

FORCE_SEED=false
[ "${1:-}" = "--seed" ] && FORCE_SEED=true

echo "==> Installing dependencies..."
pnpm install

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example..."
  cp .env.example .env
else
  echo "==> .env already exists, leaving it alone."
fi

mkdir -p data

echo "==> Applying migrations and seeding the admin user..."
pnpm tsx scripts/migrate.ts

# Only seed a database that has no transactions yet, so re-running setup on a
# workspace with real imported data can't wipe it.
TX_COUNT=$(pnpm tsx -e 'import{createClient}from"@libsql/client";const c=createClient({url:"file:data/finance.db"});c.execute("SELECT COUNT(*) AS n FROM transactions").then(r=>{console.log(r.rows[0].n);process.exit(0)}).catch(()=>{console.log(0);process.exit(0)})')

if [ "$TX_COUNT" = "0" ] || [ "$FORCE_SEED" = true ]; then
  echo "==> Seeding dummy data..."
  npx tsx scripts/seed.ts
else
  echo "==> Database already has $TX_COUNT transactions, skipping seed (use 'pnpm db:seed' to overwrite)."
fi

echo ""
echo "Setup complete. Run 'pnpm dev', then:"
echo "  demo / demo    the finance app, with a year of dummy data"
echo "  admin / admin  /backoffice (admins cannot open the finance app)"
