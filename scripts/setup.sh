#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing dependencies..."
npm install

# Create .env from example if it doesn't exist
if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example..."
  cp .env.example .env
else
  echo "==> .env already exists, skipping..."
fi

# Create data directory for SQLite
mkdir -p data

echo "==> Pushing database schema..."
npx drizzle-kit push

echo "==> Initializing database (seeding admin user & default categories)..."
npx tsx scripts/db-init.ts

echo ""
echo "Setup complete! Run 'npm run dev' to start the development server."
echo "Login with admin / admin"
