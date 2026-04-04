import { db } from "./index";
import { sql } from "drizzle-orm";

/**
 * Initialize database tables.
 * Called on app startup to ensure all tables exist.
 */
export async function initializeDatabase() {
  // Create accounts table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'joint', 'credit', 'other')),
      bank_name TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      initial_balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Create categories table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      icon TEXT,
      color TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Create transactions table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      balance REAL,
      category_id TEXT REFERENCES categories(id),
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'internal_transfer', 'reimbursement')),
      linked_transaction_id TEXT,
      reimburses_transaction_id TEXT,
      notes TEXT,
      is_manual INTEGER NOT NULL DEFAULT 0,
      import_batch_id TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Create category_rules table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS category_rules (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      match_type TEXT NOT NULL DEFAULT 'contains' CHECK(match_type IN ('contains', 'exact', 'starts_with')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Create budgets table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      period TEXT NOT NULL CHECK(period IN ('daily', 'weekly', 'monthly', 'yearly')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Create recurring_transactions table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      category_id TEXT REFERENCES categories(id),
      frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
      day_of_week INTEGER,
      day_of_month INTEGER,
      month_of_year INTEGER,
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Create import_batches table
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      transaction_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    )
  `);

  // Add iban column to accounts (migration)
  await db.run(sql`ALTER TABLE accounts ADD COLUMN iban TEXT`).catch(() => {
    // Column already exists, ignore
  });

  // Add sort_order column to accounts (migration)
  await db.run(sql`ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`).catch(() => {
    // Column already exists, ignore
  });

  // Add reimburses_transaction_id column to transactions (migration)
  await db.run(sql`ALTER TABLE transactions ADD COLUMN reimburses_transaction_id TEXT`).catch(() => {
    // Column already exists, ignore
  });

  // Migrate transactions table CHECK constraint to include 'reimbursement' type.
  // SQLite can't ALTER CHECK constraints, so we must recreate the table.
  // Only run if the old constraint is still in place.
  try {
    const tableInfo = await db.run(sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'`);
    const createSql = (tableInfo.rows[0] as Record<string, unknown>)?.sql as string || "";
    if (createSql.includes("'internal_transfer')") && !createSql.includes("'reimbursement'")) {
      await db.run(sql`PRAGMA foreign_keys = OFF`);
      await db.run(sql`
        CREATE TABLE transactions_new (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          balance REAL,
          category_id TEXT REFERENCES categories(id),
          type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'internal_transfer', 'reimbursement')),
          linked_transaction_id TEXT,
          reimburses_transaction_id TEXT,
          notes TEXT,
          is_manual INTEGER NOT NULL DEFAULT 0,
          import_batch_id TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await db.run(sql`
        INSERT INTO transactions_new
        SELECT id, account_id, date, description, amount, balance, category_id, type,
               linked_transaction_id, reimburses_transaction_id, notes, is_manual,
               import_batch_id, created_at
        FROM transactions
      `);
      await db.run(sql`DROP TABLE transactions`);
      await db.run(sql`ALTER TABLE transactions_new RENAME TO transactions`);
      await db.run(sql`PRAGMA foreign_keys = ON`);
    }
  } catch (e) {
    console.error("Failed to migrate transactions CHECK constraint:", e);
  }

  // Create reimbursement_links junction table (many-to-many: reimbursements ↔ expenses)
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS reimbursement_links (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      expense_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    )
  `);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reimb_links_reimbursement ON reimbursement_links(reimbursement_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_reimb_links_expense ON reimbursement_links(expense_id)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_reimb_links_unique ON reimbursement_links(reimbursement_id, expense_id)`);

  // Migrate existing 1:1 reimbursement links to the junction table
  await db.run(sql`
    INSERT OR IGNORE INTO reimbursement_links (id, reimbursement_id, expense_id, created_at)
    SELECT hex(randomblob(16)), id, reimburses_transaction_id, created_at
    FROM transactions
    WHERE reimburses_transaction_id IS NOT NULL
  `);

  // Create transaction_groups table (Pots)
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS transaction_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL
    )
  `);

  // Add group_id column to transactions
  await db.run(sql`ALTER TABLE transactions ADD COLUMN group_id TEXT`).catch(() => {
    // Column already exists, ignore
  });

  // Create useful indexes
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_reimburses ON transactions(reimburses_transaction_id)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(group_id)`);

  // Seed default categories if none exist
  const existingCategories = await db.run(sql`SELECT COUNT(*) as count FROM categories`);
  const count = (existingCategories.rows[0] as Record<string, unknown>)?.count as number;

  if (count === 0) {
    const defaultCategories = [
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

    for (const cat of defaultCategories) {
      await db.run(sql`
        INSERT INTO categories (id, name, icon, color, created_at)
        VALUES (${crypto.randomUUID()}, ${cat.name}, ${cat.icon}, ${cat.color}, ${new Date().toISOString()})
      `);
    }
  }
}
