import { db } from "./index";
import { sql } from "drizzle-orm";
import crypto from "crypto";

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

// Default categories seeded for each new user
const DEFAULT_CATEGORIES = [
  { name: "Groceries", icon: "ShoppingCart", color: "#22c55e" },
  { name: "Dining Out", icon: "UtensilsCrossed", color: "#f97316" },
  { name: "Coffee", icon: "Coffee", color: "#92400e" },
  { name: "Transport", icon: "Car", color: "#3b82f6" },
  { name: "Housing", icon: "Home", color: "#8b5cf6" },
  { name: "Utilities", icon: "Zap", color: "#eab308" },
  { name: "Entertainment", icon: "Tv", color: "#ec4899" },
  { name: "Shopping", icon: "ShoppingBag", color: "#14b8a6" },
  { name: "Health", icon: "Heart", color: "#ef4444" },
  { name: "Subscriptions", icon: "CreditCard", color: "#6366f1" },
  { name: "Salary", icon: "Banknote", color: "#10b981" },
  { name: "Internal Transfer", icon: "ArrowLeftRight", color: "#94a3b8" },
  { name: "Other", icon: "MoreHorizontal", color: "#71717a" },
];

/**
 * Seed default categories for a specific user.
 */
export async function seedCategoriesForUser(userId: string) {
  const existing = await db.run(
    sql`SELECT COUNT(*) as count FROM categories WHERE user_id = ${userId}`
  );
  const count = (existing.rows[0] as Record<string, unknown>)?.count as number;

  if (count === 0) {
    for (const [i, cat] of DEFAULT_CATEGORIES.entries()) {
      await db.run(sql`
        INSERT INTO categories (id, user_id, name, icon, color, sort_order, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${cat.name}, ${cat.icon}, ${cat.color}, ${i}, ${new Date().toISOString()})
      `);
    }
  }
}

/**
 * Initialize database data: seed admin user, run data migrations, create indexes.
 * Table creation is handled by `drizzle-kit push` (see build script).
 */
export async function initializeDatabase() {
  // ── Seed admin user if no users exist ──────────────────────────────────
  const userCount = await db.run(sql`SELECT COUNT(*) as count FROM "user"`);
  const numUsers = (userCount.rows[0] as Record<string, unknown>)?.count as number;

  let adminUserId: string | null = null;

  if (numUsers === 0) {
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin";
    const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || "Admin";

    adminUserId = crypto.randomUUID();
    const hashedPassword = await hashPassword(adminPassword);
    const now = Date.now();

    await db.run(sql`
      INSERT INTO "user" (id, name, email, email_verified, username, display_username, role, created_at, updated_at)
      VALUES (${adminUserId}, ${adminDisplayName}, ${adminUsername + '@local'}, 0, ${adminUsername}, ${adminDisplayName}, 'admin', ${now}, ${now})
    `);

    await db.run(sql`
      INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${adminUserId}, 'credential', ${adminUserId}, ${hashedPassword}, ${now}, ${now})
    `);

    console.log(`Admin user "${adminUsername}" created. Change the password after first login.`);
  }

  // ── Data migrations & column-level drift repair ─────────────────────────
  // Versioned migrations (drizzle/*.sql, applied by scripts/migrate.ts) create
  // every schema-declared table. Existing databases baselined onto 0000 may
  // still be missing columns that predate the baseline — repair those here
  // idempotently. Genuine data backfills also live here.

  // hide_internal_transfers: added with the "drop Reserved feature" change.
  // Missing on any DB baselined before it (or where the old drizzle-kit push
  // skipped it as a data-loss statement); reads of user_preferences 500
  // without it. Idempotent — no-ops once the column exists.
  await db
    .run(sql`ALTER TABLE user_preferences ADD COLUMN hide_internal_transfers INTEGER NOT NULL DEFAULT 0`)
    .catch(() => {});

  // category_source: tracks whether categoryId was set by a rule or manually.
  // Backfill existing categorized rows as 'manual' so a subsequent "Recalculate
  // All" can never wipe pre-existing user assignments.
  const addedCategorySource = await db
    .run(sql`ALTER TABLE transactions ADD COLUMN category_source TEXT`)
    .then(() => true)
    .catch(() => false);
  if (addedCategorySource) {
    await db.run(sql`
      UPDATE transactions SET category_source = 'manual' WHERE category_id IS NOT NULL
    `);
  }

  // Add user_id to data tables and backfill with admin user
  if (!adminUserId) {
    const adminResult = await db.run(sql`SELECT id FROM "user" WHERE role = 'admin' LIMIT 1`);
    adminUserId = (adminResult.rows[0] as Record<string, unknown>)?.id as string;
  }

  const tablesNeedingUserId = [
    "accounts", "transactions", "categories", "category_rules",
    "budgets", "recurring_transactions", "import_batches", "transaction_groups",
  ];
  for (const table of tablesNeedingUserId) {
    await db.run(sql`ALTER TABLE ${sql.identifier(table)} ADD COLUMN user_id TEXT`).catch(() => {});
    if (adminUserId) {
      await db.run(sql`UPDATE ${sql.identifier(table)} SET user_id = ${adminUserId} WHERE user_id IS NULL`);
    }
  }

  // Migrate categories UNIQUE(name) → UNIQUE(name, user_id)
  try {
    const catInfo = await db.run(sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='categories'`);
    const catSql = (catInfo.rows[0] as Record<string, unknown>)?.sql as string || "";
    if (catSql.includes("name TEXT NOT NULL UNIQUE")) {
      await db.run(sql`PRAGMA foreign_keys = OFF`);
      await db.run(sql`
        CREATE TABLE categories_new (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          icon TEXT,
          color TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )
      `);
      await db.run(sql`INSERT INTO categories_new (id, user_id, name, icon, color, sort_order, created_at) SELECT id, user_id, name, icon, color, sort_order, created_at FROM categories`);
      await db.run(sql`DROP TABLE categories`);
      await db.run(sql`ALTER TABLE categories_new RENAME TO categories`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
  } catch (e) {
    console.error("Failed to migrate categories UNIQUE constraint:", e);
  }

  // Migrate transactions CHECK constraint to include 'reimbursement' and 'reserved'.
  // Two distinct upgrade paths converge on the same final shape:
  //   (a) very old DB: missing 'reimbursement' (and 'reserved').
  //   (b) DB already migrated past (a) but missing 'reserved'.
  try {
    const tableInfo = await db.run(sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'`);
    const createSql = (tableInfo.rows[0] as Record<string, unknown>)?.sql as string || "";
    const needsRebuild =
      createSql.includes("'internal_transfer')") ||
      (createSql.includes("'reimbursement'") && !createSql.includes("'reserved'"));
    if (needsRebuild) {
      await db.run(sql`PRAGMA foreign_keys = OFF`);
      await db.run(sql`
        CREATE TABLE transactions_new (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          date TEXT NOT NULL, name TEXT, description TEXT NOT NULL,
          amount REAL NOT NULL, balance REAL,
          category_id TEXT REFERENCES categories(id),
          category_source TEXT,
          type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'internal_transfer', 'reimbursement', 'reserved')),
          linked_transaction_id TEXT, reimburses_transaction_id TEXT,
          notes TEXT, is_manual INTEGER NOT NULL DEFAULT 0,
          import_batch_id TEXT, group_id TEXT,
          recurring_transaction_id TEXT REFERENCES recurring_transactions(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        )
      `);
      await db.run(sql`
        INSERT INTO transactions_new
        SELECT id, user_id, account_id, date, name, description, amount, balance, category_id, category_source, type,
               linked_transaction_id, reimburses_transaction_id, notes, is_manual,
               import_batch_id, group_id, recurring_transaction_id, created_at
        FROM transactions
      `);
      await db.run(sql`DROP TABLE transactions`);
      await db.run(sql`ALTER TABLE transactions_new RENAME TO transactions`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
  } catch (e) {
    console.error("Failed to migrate transactions CHECK constraint:", e);
  }

  // recurring_transactions originally had CHECK(type IN ('income', 'expense')).
  // Add 'reserved' so users can schedule recurring set-aside transfers.
  try {
    const tableInfo = await db.run(sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='recurring_transactions'`);
    const createSql = (tableInfo.rows[0] as Record<string, unknown>)?.sql as string || "";
    if (createSql.length > 0 && !createSql.includes("'reserved'")) {
      await db.run(sql`PRAGMA foreign_keys = OFF`);
      await db.run(sql`
        CREATE TABLE recurring_transactions_new (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'reserved')),
          category_id TEXT REFERENCES categories(id),
          frequency TEXT NOT NULL,
          day_of_week INTEGER, day_of_month INTEGER, month_of_year INTEGER,
          start_date TEXT NOT NULL, end_date TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        )
      `);
      await db.run(sql`
        INSERT INTO recurring_transactions_new
        SELECT id, user_id, account_id, description, amount, type, category_id,
               frequency, day_of_week, day_of_month, month_of_year,
               start_date, end_date, is_active, created_at
        FROM recurring_transactions
      `);
      await db.run(sql`DROP TABLE recurring_transactions`);
      await db.run(sql`ALTER TABLE recurring_transactions_new RENAME TO recurring_transactions`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
  } catch (e) {
    console.error("Failed to migrate recurring_transactions CHECK constraint:", e);
  }

  // The Reserved (set-aside) feature was removed: fold its transactions back
  // into income/expense based on amount sign (same restore rule the feature
  // itself used). The CHECK constraints above still permit 'reserved' in old
  // DBs — harmless, and it avoids another table rebuild.
  try {
    await db.run(sql`
      UPDATE transactions
         SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END
       WHERE type = 'reserved'
    `);
    await db.run(sql`
      UPDATE recurring_transactions
         SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END
       WHERE type = 'reserved'
    `);
  } catch (e) {
    console.error("Failed to fold reserved transactions into income/expense:", e);
  }

  // Migrate existing 1:1 reimbursement links to junction table
  await db.run(sql`
    INSERT OR IGNORE INTO reimbursement_links (id, reimbursement_id, expense_id, created_at)
    SELECT hex(randomblob(16)), id, reimburses_transaction_id, created_at
    FROM transactions WHERE reimburses_transaction_id IS NOT NULL
  `);

  // ── One-shot data backfills ────────────────────────────────────────────
  // Marker table so each backfill runs exactly once across deploys. A user
  // who later unlinks a transaction won't have it re-linked next startup.
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS one_time_migrations (
      name TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    )
  `);

  // Backfill recurring_transaction_id on existing transactions using the same
  // matching heuristic as `findMatchingRecurring` (csv-utils.ts): same account
  // and direction, description substring match either way, amount within ±10%
  // (or ±€2).
  // ponytail: no ORDER BY closest-amount tiebreak — SQLite can't resolve the
  // correlated `transactions.amount` inside a subquery's ORDER BY, and the
  // WHERE already bounds matches tightly enough that ties are near-duplicates.
  // If precise tiebreaking is ever needed, do the backfill in app code with
  // findMatchingRecurring instead.
  const backfillName = "recurring_link_backfill_v1";
  const markerCheck = await db.run(
    sql`SELECT 1 AS found FROM one_time_migrations WHERE name = ${backfillName}`
  );
  if (markerCheck.rows.length === 0) {
    try {
      await db.run(sql`
        UPDATE transactions
        SET recurring_transaction_id = (
          SELECT p.id
          FROM recurring_transactions p
          WHERE p.user_id = transactions.user_id
            AND p.account_id = transactions.account_id
            AND p.is_active = 1
            AND (
              (transactions.amount < 0 AND p.type = 'expense')
              OR (transactions.amount > 0 AND p.type = 'income')
            )
            AND TRIM(p.description) <> ''
            AND TRIM(COALESCE(transactions.name || ' ', '') || transactions.description) <> ''
            AND (
              INSTR(
                LOWER(COALESCE(transactions.name || ' ', '') || transactions.description),
                LOWER(TRIM(p.description))
              ) > 0
              OR INSTR(
                LOWER(TRIM(p.description)),
                LOWER(TRIM(COALESCE(transactions.name || ' ', '') || transactions.description))
              ) > 0
            )
            AND ABS(ABS(p.amount) - ABS(transactions.amount)) <= MAX(2.0, ABS(transactions.amount) * 0.1)
          LIMIT 1
        )
        WHERE recurring_transaction_id IS NULL
          AND type IN ('income', 'expense')
      `);
      await db.run(sql`
        INSERT INTO one_time_migrations (name, completed_at)
        VALUES (${backfillName}, ${new Date().toISOString()})
      `);
    } catch (e) {
      console.error("Failed to backfill recurring_transaction_id:", e);
    }
  }

  // ── Audit log migration ────────────────────────────────────────────────
  // Create unified audit_log table and migrate old admin_audit_log data
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      target_type TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Migrate existing admin_audit_log entries
  try {
    const oldTable = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='admin_audit_log'`);
    if (oldTable.rows.length > 0) {
      await db.run(sql`
        INSERT OR IGNORE INTO audit_log (id, user_id, category, action, target_id, target_type, details, ip_address, created_at)
        SELECT id, admin_id, 'admin', action, target_user_id, 'user', details, ip_address, created_at
        FROM admin_audit_log
      `);
      await db.run(sql`DROP TABLE admin_audit_log`);
    }
  } catch (e) {
    console.error("Failed to migrate admin_audit_log:", e);
  }

  // ── Indexes ────────────────────────────────────────────────────────────
  // Only indexes NOT created by drizzle-kit push live here. Push builds every
  // index declared in schema.ts (and its userId-prefixed composites cover the
  // single-column userId lookups), so those are omitted. auth-schema.ts is not
  // in the push config, so its indexes are still created below.
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_reimburses ON transactions(reimburses_transaction_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(group_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reimb_links_reimbursement ON reimbursement_links(reimbursement_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reimb_links_expense ON reimbursement_links(expense_id)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_reimb_links_unique ON reimbursement_links(reimbursement_id, expense_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_category_rules_user ON category_rules(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_recurring_transactions_user ON recurring_transactions(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_import_batches_user ON import_batches(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transaction_groups_user ON transaction_groups(user_id)`);

  // Auth-schema indexes (defined in auth-schema.ts). Created here so they
  // exist before drizzle-kit push tries to diff against them on next deploy.
  await db.run(sql`CREATE INDEX IF NOT EXISTS account_userId_idx ON account(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS session_userId_idx ON session(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS passkey_userId_idx ON passkey(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS passkey_credentialID_idx ON passkey(credential_id)`);

  // ── Seed default categories for admin user ──────────────────────────────
  if (!adminUserId) {
    const adminResult = await db.run(sql`SELECT id FROM "user" WHERE role = 'admin' LIMIT 1`);
    adminUserId = (adminResult.rows[0] as Record<string, unknown>)?.id as string;
  }
  if (adminUserId) {
    await seedCategoriesForUser(adminUserId);
  }
}
