import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─── Accounts ────────────────────────────────────────────────────────────────
// Represents a bank account (checking, savings, joint, etc.)
export const accounts = sqliteTable("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["checking", "savings", "joint", "credit", "other"],
  }).notNull(),
  bankName: text("bank_name"),
  currency: text("currency").notNull().default("EUR"),
  initialBalance: real("initial_balance").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Transactions ────────────────────────────────────────────────────────────
// Individual financial transactions imported from CSV or entered manually
export const transactions = sqliteTable("transactions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // ISO date string
  description: text("description").notNull(),
  amount: real("amount").notNull(), // Positive = income, Negative = expense
  balance: real("balance"), // Running balance if provided by bank
  categoryId: text("category_id").references(() => categories.id),
  type: text("type", {
    enum: ["income", "expense", "internal_transfer"],
  }).notNull(),
  // Link to the matching transaction in another account (for internal transfers)
  linkedTransactionId: text("linked_transaction_id"),
  notes: text("notes"),
  isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
  importBatchId: text("import_batch_id"), // Track which CSV upload this came from
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Categories ──────────────────────────────────────────────────────────────
// User-defined spending categories
export const categories = sqliteTable("categories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  icon: text("icon"), // Lucide icon name
  color: text("color"), // Hex color for charts
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Category Rules ──────────────────────────────────────────────────────────
// Auto-categorization rules (e.g., "Starbucks" -> "Coffee")
export const categoryRules = sqliteTable("category_rules", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  pattern: text("pattern").notNull(), // Text pattern to match in description
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  matchType: text("match_type", {
    enum: ["contains", "exact", "starts_with"],
  })
    .notNull()
    .default("contains"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Budgets ─────────────────────────────────────────────────────────────────
// Budget limits per category with configurable time periods
export const budgets = sqliteTable("budgets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  period: text("period", {
    enum: ["daily", "weekly", "monthly", "yearly"],
  }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Recurring Transactions ──────────────────────────────────────────────────
// Expected recurring incomes and expenses
export const recurringTransactions = sqliteTable("recurring_transactions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  categoryId: text("category_id").references(() => categories.id),
  // Recurrence configuration
  frequency: text("frequency", {
    enum: ["weekly", "biweekly", "monthly", "yearly"],
  }).notNull(),
  dayOfWeek: integer("day_of_week"), // 0=Sun, 1=Mon, ... 6=Sat (for weekly)
  dayOfMonth: integer("day_of_month"), // 1-31 (for monthly)
  monthOfYear: integer("month_of_year"), // 1-12 (for yearly)
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Import Batches ──────────────────────────────────────────────────────────
// Track CSV imports for audit trail
export const importBatches = sqliteTable("import_batches", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  transactionCount: integer("transaction_count").notNull(),
  importedAt: text("imported_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ many }) => ({
  transactions: many(transactions),
  recurringTransactions: many(recurringTransactions),
  importBatches: many(importBatches),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  transactions: many(transactions),
  rules: many(categoryRules),
  budgets: many(budgets),
}));

export const categoryRulesRelations = relations(categoryRules, ({ one }) => ({
  category: one(categories, {
    fields: [categoryRules.categoryId],
    references: [categories.id],
  }),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const recurringTransactionsRelations = relations(
  recurringTransactions,
  ({ one }) => ({
    account: one(accounts, {
      fields: [recurringTransactions.accountId],
      references: [accounts.id],
    }),
    category: one(categories, {
      fields: [recurringTransactions.categoryId],
      references: [categories.id],
    }),
  })
);

export const importBatchesRelations = relations(importBatches, ({ one }) => ({
  account: one(accounts, {
    fields: [importBatches.accountId],
    references: [accounts.id],
  }),
}));

// ─── Type Exports ────────────────────────────────────────────────────────────
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type CategoryRule = typeof categoryRules.$inferSelect;
export type NewCategoryRule = typeof categoryRules.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type RecurringTransaction = typeof recurringTransactions.$inferSelect;
export type NewRecurringTransaction = typeof recurringTransactions.$inferInsert;
export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
