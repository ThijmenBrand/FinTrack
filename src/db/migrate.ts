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
    for (const cat of DEFAULT_CATEGORIES) {
      await db.run(sql`
        INSERT INTO categories (id, user_id, name, icon, color, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${cat.name}, ${cat.icon}, ${cat.color}, ${new Date().toISOString()})
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
      INSERT INTO "user" (id, name, email, emailVerified, username, displayName, role, createdAt, updatedAt)
      VALUES (${adminUserId}, ${adminDisplayName}, ${adminUsername + '@local'}, 0, ${adminUsername}, ${adminDisplayName}, 'admin', ${now}, ${now})
    `);

    await db.run(sql`
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${crypto.randomUUID()}, ${adminUserId}, 'credential', ${adminUserId}, ${hashedPassword}, ${now}, ${now})
    `);

    console.log(`Admin user "${adminUsername}" created. Change the password after first login.`);
  }

  // ── Data migrations ────────────────────────────────────────────────────
  // These are safe no-ops if the column already exists (catch silences the error)
  await db.run(sql`ALTER TABLE accounts ADD COLUMN iban TEXT`).catch(() => {});
  await db.run(sql`ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(sql`ALTER TABLE transactions ADD COLUMN reimburses_transaction_id TEXT`).catch(() => {});
  await db.run(sql`ALTER TABLE transactions ADD COLUMN group_id TEXT`).catch(() => {});

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
          created_at TEXT NOT NULL
        )
      `);
      await db.run(sql`INSERT INTO categories_new SELECT id, user_id, name, icon, color, created_at FROM categories`);
      await db.run(sql`DROP TABLE categories`);
      await db.run(sql`ALTER TABLE categories_new RENAME TO categories`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
  } catch (e) {
    console.error("Failed to migrate categories UNIQUE constraint:", e);
  }

  // Migrate transactions CHECK constraint to include 'reimbursement'
  try {
    const tableInfo = await db.run(sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'`);
    const createSql = (tableInfo.rows[0] as Record<string, unknown>)?.sql as string || "";
    if (createSql.includes("'internal_transfer')") && !createSql.includes("'reimbursement'")) {
      await db.run(sql`PRAGMA foreign_keys = OFF`);
      await db.run(sql`
        CREATE TABLE transactions_new (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          date TEXT NOT NULL, description TEXT NOT NULL,
          amount REAL NOT NULL, balance REAL,
          category_id TEXT REFERENCES categories(id),
          type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'internal_transfer', 'reimbursement')),
          linked_transaction_id TEXT, reimburses_transaction_id TEXT,
          notes TEXT, is_manual INTEGER NOT NULL DEFAULT 0,
          import_batch_id TEXT, group_id TEXT, created_at TEXT NOT NULL
        )
      `);
      await db.run(sql`
        INSERT INTO transactions_new
        SELECT id, user_id, account_id, date, description, amount, balance, category_id, type,
               linked_transaction_id, reimburses_transaction_id, notes, is_manual,
               import_batch_id, group_id, created_at
        FROM transactions
      `);
      await db.run(sql`DROP TABLE transactions`);
      await db.run(sql`ALTER TABLE transactions_new RENAME TO transactions`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
  } catch (e) {
    console.error("Failed to migrate transactions CHECK constraint:", e);
  }

  // Migrate existing 1:1 reimbursement links to junction table
  await db.run(sql`
    INSERT OR IGNORE INTO reimbursement_links (id, reimbursement_id, expense_id, created_at)
    SELECT hex(randomblob(16)), id, reimburses_transaction_id, created_at
    FROM transactions WHERE reimburses_transaction_id IS NOT NULL
  `);

  // ── Indexes ────────────────────────────────────────────────────────────
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_reimburses ON transactions(reimburses_transaction_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(group_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reimb_links_reimbursement ON reimbursement_links(reimbursement_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reimb_links_expense ON reimbursement_links(expense_id)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_reimb_links_unique ON reimbursement_links(reimbursement_id, expense_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_category_rules_user ON category_rules(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_recurring_transactions_user ON recurring_transactions(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_import_batches_user ON import_batches(user_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transaction_groups_user ON transaction_groups(user_id)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_user ON categories(name, user_id)`);

  // ── Seed default categories for admin user ──────────────────────────────
  if (!adminUserId) {
    const adminResult = await db.run(sql`SELECT id FROM "user" WHERE role = 'admin' LIMIT 1`);
    adminUserId = (adminResult.rows[0] as Record<string, unknown>)?.id as string;
  }
  if (adminUserId) {
    await seedCategoriesForUser(adminUserId);
  }
}
