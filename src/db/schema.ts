import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// ─── Users (Better Auth compatible) ────────────────────────────────────────
export const user = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  username: text("username").notNull().unique(),
  displayName: text("displayName"),
  role: text("role").default("user"),
  banned: integer("banned", { mode: "boolean" }),
  banReason: text("banReason"),
  banExpires: integer("banExpires", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date()),
});

// ─── Better Auth: Session ──────────────────────────────────────────────────
export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date()),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonatedBy"),
});

// ─── Better Auth: Account (auth provider accounts) ─────────────────────────
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date()),
});

// ─── Better Auth: Verification ─────────────────────────────────────────────
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date()),
});

// ─── Better Auth: Passkey ──────────────────────────────────────────────────
export const passkey = sqliteTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("publicKey").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credentialID").notNull().unique(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("deviceType").notNull(),
  backedUp: integer("backedUp", { mode: "boolean" }).notNull().default(false),
  transports: text("transports"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

// ─── User PIN ───────────────────────────────────────────────────────────────
export const userPin = sqliteTable("user_pin", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .unique(),
  pinHash: text("pin_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Bank Accounts ──────────────────────────────────────────────────────────
// Represents a bank account (checking, savings, joint, etc.)
export const accounts = sqliteTable("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["checking", "savings", "joint", "credit", "other"],
  }).notNull(),
  bankName: text("bank_name"),
  iban: text("iban"),
  currency: text("currency").notNull().default("EUR"),
  initialBalance: real("initial_balance").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
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
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // ISO date string
  description: text("description").notNull(),
  amount: real("amount").notNull(), // Positive = income, Negative = expense
  balance: real("balance"), // Running balance if provided by bank
  categoryId: text("category_id").references(() => categories.id),
  type: text("type", {
    enum: ["income", "expense", "internal_transfer", "reimbursement"],
  }).notNull(),
  // Link to the matching transaction in another account (for internal transfers)
  linkedTransactionId: text("linked_transaction_id"),
  // Link to the expense this transaction reimburses (for split bills)
  reimbursesTransactionId: text("reimburses_transaction_id"),
  notes: text("notes"),
  isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
  importBatchId: text("import_batch_id"), // Track which CSV upload this came from
  groupId: text("group_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Categories ──────────────────────────────────────────────────────────────
// User-defined spending categories (unique per user)
export const categories = sqliteTable("categories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon"), // Lucide icon name
  color: text("color"), // Hex color for charts
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("idx_categories_name_user").on(table.name, table.userId),
]);

// ─── Category Rules ──────────────────────────────────────────────────────────
// Auto-categorization rules (e.g., "Starbucks" -> "Coffee")
export const categoryRules = sqliteTable("category_rules", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  transactionCount: integer("transaction_count").notNull(),
  importedAt: text("imported_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Transaction Groups (Pots) ──────────────────────────────────────────────
// Named groups of transactions (e.g. "Weekend trip") with a category.
// The pot's net amount counts in summaries instead of individual transactions.
export const transactionGroups = sqliteTable("transaction_groups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  categoryId: text("category_id").references(() => categories.id),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Reimbursement Links ────────────────────────────────────────────────────
// Junction table: links reimbursement transactions to the expenses they reimburse (many-to-many)
export const reimbursementLinks = sqliteTable("reimbursement_links", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  reimbursementId: text("reimbursement_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  expenseId: text("expense_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(user, ({ many }) => ({
  accounts: many(accounts),
  transactions: many(transactions),
  categories: many(categories),
  budgets: many(budgets),
  recurringTransactions: many(recurringTransactions),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(user, { fields: [accounts.userId], references: [user.id] }),
  transactions: many(transactions),
  recurringTransactions: many(recurringTransactions),
  importBatches: many(importBatches),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(user, { fields: [transactions.userId], references: [user.id] }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  group: one(transactionGroups, {
    fields: [transactions.groupId],
    references: [transactionGroups.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(user, { fields: [categories.userId], references: [user.id] }),
  transactions: many(transactions),
  rules: many(categoryRules),
  budgets: many(budgets),
}));

export const categoryRulesRelations = relations(categoryRules, ({ one }) => ({
  user: one(user, { fields: [categoryRules.userId], references: [user.id] }),
  category: one(categories, {
    fields: [categoryRules.categoryId],
    references: [categories.id],
  }),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  user: one(user, { fields: [budgets.userId], references: [user.id] }),
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const recurringTransactionsRelations = relations(
  recurringTransactions,
  ({ one }) => ({
    user: one(user, { fields: [recurringTransactions.userId], references: [user.id] }),
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
  user: one(user, { fields: [importBatches.userId], references: [user.id] }),
  account: one(accounts, {
    fields: [importBatches.accountId],
    references: [accounts.id],
  }),
}));

export const transactionGroupsRelations = relations(
  transactionGroups,
  ({ one, many }) => ({
    user: one(user, { fields: [transactionGroups.userId], references: [user.id] }),
    category: one(categories, {
      fields: [transactionGroups.categoryId],
      references: [categories.id],
    }),
    transactions: many(transactions),
  })
);

// ─── Admin Audit Log ──────────────────────────────────────────────────────
// Tracks sensitive admin actions (password resets, role changes, user deletion, etc.)
export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  adminId: text("admin_id").notNull(),
  action: text("action").notNull(), // e.g. "password_reset", "role_change", "user_create", "user_delete"
  targetUserId: text("target_user_id").notNull(),
  details: text("details"), // JSON string with extra context
  ipAddress: text("ip_address"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Type Exports ────────────────────────────────────────────────────────────
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
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
export type ReimbursementLink = typeof reimbursementLinks.$inferSelect;
export type NewReimbursementLink = typeof reimbursementLinks.$inferInsert;
export type TransactionGroup = typeof transactionGroups.$inferSelect;
export type NewTransactionGroup = typeof transactionGroups.$inferInsert;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
export type Passkey = typeof passkey.$inferSelect;
export type UserPin = typeof userPin.$inferSelect;
