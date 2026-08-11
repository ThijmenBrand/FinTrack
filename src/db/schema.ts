import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
export {
  user,
  session,
  account,
  verification,
  passkey,
  rateLimit,
  twoFactor,
  userRelations,
  sessionRelations,
  accountRelations,
  passkeyRelations,
  twoFactorRelations,
} from "./auth-schema";
import { user, session, account, passkey } from "./auth-schema";

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
  lockoutCount: integer("lockout_count").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Budget Plans ────────────────────────────────────────────────────────────
// A named budget: owns a set of accounts (accounts.budgetId, exclusive) and a
// set of per-category allocations (budgets.budgetId). Exactly one plan per
// user is the "main" budget shown on the dashboard — enforced by a partial
// unique index.
export const budgetPlans = sqliteTable("budget_plans", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
  // "monthly" — every month stands alone, the classic behaviour.
  // "yearly" — the plan's allocations form one annual envelope per category:
  // each month gets amount/12 plus whatever the earlier months left over
  // (or owe). Tracked in budget_ledger.
  period: text("period", { enum: ["monthly", "yearly"] }).notNull().default("monthly"),
  // First financial month the yearly envelope covers, as `YYYY-MM-DD` (the FM
  // start). Switching a plan to yearly mid-year starts fresh here rather than
  // backfilling carry-over the user never saw. Null while the plan is monthly.
  periodStartedAt: text("period_started_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("idx_budget_plans_user").on(table.userId),
  uniqueIndex("idx_budget_plans_user_main")
    .on(table.userId)
    .where(sql`is_main = 1`),
]);

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
  /** Stable bank slug from BANKS in @/lib/banks; drives import behaviour. */
  bank: text("bank"),
  iban: text("iban"),
  currency: text("currency").notNull().default("EUR"),
  initialBalance: real("initial_balance").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  // The budget plan this account's spending counts toward. Exclusive: an
  // account belongs to at most one plan. Null = not in any budget.
  budgetId: text("budget_id").references(() => budgetPlans.id, { onDelete: "set null" }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("idx_accounts_user").on(table.userId),
]);

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
  // Counterparty / payee from the CSV "name" column. Null for legacy rows
  // imported before name and description were stored separately.
  name: text("name"),
  description: text("description").notNull(),
  amount: real("amount").notNull(), // Positive = income, Negative = expense
  balance: real("balance"), // Running balance if provided by bank
  categoryId: text("category_id").references(() => categories.id),
  // Tracks how categoryId was set so "Recalculate All" can wipe rule-applied
  // categories without destroying manual user assignments. Null when no category.
  categorySource: text("category_source", { enum: ["manual", "rule"] }),
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
  // Link to the recurring plan this transaction fulfills. When set, the
  // transaction is excluded from `spentThisMonth` because the plan's monthly
  // amount is already counted via `totalFixedCosts` — keeping both would
  // double-count.
  recurringTransactionId: text("recurring_transaction_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("idx_transactions_user_date").on(table.userId, table.date),
  index("idx_transactions_account").on(table.accountId),
  index("idx_transactions_user_category_type_date").on(table.userId, table.categoryId, table.type, table.date),
  index("idx_transactions_user_group").on(table.userId, table.groupId),
  index("idx_transactions_recurring").on(table.recurringTransactionId),
]);

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
  sortOrder: integer("sort_order").notNull().default(0),
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
// Budget limits per category with configurable time periods.
// `status` distinguishes user-applied budgets ("active") from system-generated
// proposals waiting for user approval ("suggested"). `source` records whether
// a budget was set manually or generated from historical spending.
export const budgets = sqliteTable("budgets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // The plan this allocation belongs to. Nullable only for pre-plan legacy
  // rows; the 0009 backfill attaches every row to the user's Main plan.
  budgetId: text("budget_id").references(() => budgetPlans.id, { onDelete: "cascade" }),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  period: text("period", {
    enum: ["daily", "weekly", "monthly", "yearly"],
  }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["active", "suggested"] }).notNull().default("active"),
  source: text("source", { enum: ["manual", "auto"] }).notNull().default("manual"),
  generatedAt: text("generated_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("idx_budgets_user_active").on(table.userId, table.isActive),
  index("idx_budgets_user_status").on(table.userId, table.status),
  index("idx_budgets_plan").on(table.budgetId),
]);

// ─── Budget Ledger ───────────────────────────────────────────────────────────
// One row per (yearly plan, category, financial month). Only yearly plans
// have rows: monthly plans need no ledger because nothing carries over.
//
// `target` is the month's own share of the annual envelope (the allocation's
// monthly amount at the time the month closed). `rolloverIn` is what the
// earlier months of the same financial year left behind — positive when they
// underspent, negative when they overspent, because the envelope is one pot.
// The month's actual allowance is `target + rolloverIn`, and it hands
// `rolloverOut = target + rolloverIn − spent` to the next month.
//
// Closed months keep their `target` frozen: raising an allocation in July
// must not retroactively rewrite what January was allowed to spend. A late
// edit to an old transaction still updates that month's `spent` and
// re-cascades every rollover after it — see recomputeLedger.
export const budgetLedger = sqliteTable("budget_ledger", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  budgetId: text("budget_id")
    .notNull()
    .references(() => budgetPlans.id, { onDelete: "cascade" }),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  // Financial year: the calendar year the year's first financial month starts
  // in. With financialMonthStartDay = 1 this is just the calendar year.
  year: integer("year").notNull(),
  // 0–11, the month's position inside that financial year.
  monthIndex: integer("month_index").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  target: real("target").notNull(),
  spent: real("spent").notNull().default(0),
  rolloverIn: real("rollover_in").notNull().default(0),
  rolloverOut: real("rollover_out").notNull().default(0),
  // A finished month whose `target` no longer tracks the live allocation.
  closed: integer("closed", { mode: "boolean" }).notNull().default(false),
  computedAt: text("computed_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("idx_budget_ledger_slot").on(
    table.budgetId,
    table.categoryId,
    table.year,
    table.monthIndex,
  ),
  index("idx_budget_ledger_lookup").on(table.userId, table.budgetId, table.year),
]);

// ─── Budget Ledger Jobs ──────────────────────────────────────────────────────
// Work queue for ledger recomputation. Recomputing a year of carry-over is too
// slow to sit in a request, so writers only mark what went stale and the
// actual maths runs after the response is flushed (see runLedgerJobs).
//
// At most one row per (plan, year): a second enqueue folds into the existing
// one, so a 2,000-row import leaves a single job behind, not 2,000. A job is
// only ever "this plan-year is stale" — the worker rebuilds the whole year,
// because a changed month invalidates every rollover after it anyway.
export const budgetLedgerJobs = sqliteTable("budget_ledger_jobs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  budgetId: text("budget_id")
    .notNull()
    .references(() => budgetPlans.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  status: text("status", { enum: ["pending", "running", "failed"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  startedAt: text("started_at"),
}, (table) => [
  uniqueIndex("idx_budget_ledger_jobs_slot").on(table.budgetId, table.year),
  index("idx_budget_ledger_jobs_status").on(table.status, table.createdAt),
]);

// ─── User Preferences ────────────────────────────────────────────────────────
// Per-user automation and feature preferences. Currently used for auto-budget.
export const userPreferences = sqliteTable("user_preferences", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .unique(),
  autoBudgetEnabled: integer("auto_budget_enabled", { mode: "boolean" }).notNull().default(true),
  autoBudgetIntervalMonths: integer("auto_budget_interval_months").notNull().default(1),
  autoBudgetLookbackMonths: integer("auto_budget_lookback_months").notNull().default(3),
  lastAutoBudgetCheckAt: text("last_auto_budget_check_at"),
  // 1 = calendar month; 2-28 shifts the "financial month" boundary (e.g. 8 = 8th to 7th).
  financialMonthStartDay: integer("financial_month_start_day").notNull().default(1),
  // Account selected by default in the Insights account filter. Null = "All accounts".
  defaultAccountId: text("default_account_id").references(() => accounts.id, { onDelete: "set null" }),
  // When on, internal transfers are hidden from the transactions list by default.
  hideInternalTransfers: integer("hide_internal_transfers", { mode: "boolean" }).notNull().default(false),
  // When on, per-budget views count internal transfers whose counterpart
  // account lives in a different budget plan as expense/income (envelope-style).
  countCrossBudgetTransfers: integer("count_cross_budget_transfers", { mode: "boolean" }).notNull().default(false),
  // UI language. One of the codes in LOCALES (src/lib/i18n) — "en" | "nl".
  locale: text("locale").notNull().default("en"),
  // Simple mode: dashboard, budgets and insights hide advanced features
  // (budget plans, suggestions, deep-dive charts) behind this one switch.
  simpleMode: integer("simple_mode", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Statistics Resets ───────────────────────────────────────────────────────
// A dated line in the sand: backward-looking maths (budget averages, auto-budget
// suggestions, vs-previous comparisons) ignores everything before the newest
// reset. Transactions and the charts that plot them are untouched — the past
// stays visible, it just stops feeding the averages.
export const statResets = sqliteTable("stat_resets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // ISO YYYY-MM-DD. Averages count from this date, inclusive.
  date: text("date").notNull(),
  // Optional user note, e.g. "moved house".
  note: text("note"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("idx_stat_resets_user_date").on(table.userId, table.date),
]);

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
// When targetAmount + targetDate are set, the pot is a "spike": a planned
// irregular event that surfaces on the dashboard and forecast.
export const transactionGroups = sqliteTable("transaction_groups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  categoryId: text("category_id").references(() => categories.id),
  targetAmount: real("target_amount"),
  targetDate: text("target_date"),
  fundedAmount: real("funded_amount").notNull().default(0),
  // Set when the user archives the pot to hide it from the active list; null = active.
  archivedAt: text("archived_at"),
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
}, (table) => [
  index("idx_reimbursement_expense").on(table.expenseId),
]);

// ─── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  authAccounts: many(account),
  passkeys: many(passkey),
  accounts: many(accounts),
  transactions: many(transactions),
  categories: many(categories),
  budgets: many(budgets),
  recurringTransactions: many(recurringTransactions),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(user, { fields: [accounts.userId], references: [user.id] }),
  budgetPlan: one(budgetPlans, {
    fields: [accounts.budgetId],
    references: [budgetPlans.id],
  }),
  transactions: many(transactions),
  recurringTransactions: many(recurringTransactions),
  importBatches: many(importBatches),
}));

export const budgetPlansRelations = relations(budgetPlans, ({ one, many }) => ({
  user: one(user, { fields: [budgetPlans.userId], references: [user.id] }),
  accounts: many(accounts),
  budgets: many(budgets),
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
  recurringTransaction: one(recurringTransactions, {
    fields: [transactions.recurringTransactionId],
    references: [recurringTransactions.id],
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
  plan: one(budgetPlans, {
    fields: [budgets.budgetId],
    references: [budgetPlans.id],
  }),
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const recurringTransactionsRelations = relations(
  recurringTransactions,
  ({ one, many }) => ({
    user: one(user, { fields: [recurringTransactions.userId], references: [user.id] }),
    account: one(accounts, {
      fields: [recurringTransactions.accountId],
      references: [accounts.id],
    }),
    category: one(categories, {
      fields: [recurringTransactions.categoryId],
      references: [categories.id],
    }),
    transactions: many(transactions),
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

// ─── Audit Log ──────────────────────────────────────────────────────────
// Unified audit log for auth events, data mutations, and admin actions
export const auditLog = sqliteTable("audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id"), // nullable — failed login attempts may not have a resolved userId
  category: text("category").notNull(), // "auth" | "data" | "admin"
  action: text("action").notNull(),
  targetId: text("target_id"),
  targetType: text("target_type"), // e.g. "transaction", "account", "budget", "category", "user"
  details: text("details"), // JSON string with extra context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index("idx_audit_log_user_created").on(table.userId, table.createdAt),
  index("idx_audit_log_category_created").on(table.category, table.createdAt),
  index("idx_audit_log_created").on(table.createdAt),
]);

// ─── App Settings ────────────────────────────────────────────────────────
// Global key-value settings toggled from the backoffice (e.g. signups_enabled)
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Invites ─────────────────────────────────────────────────────────────
// Invite-only onboarding. The recipient's link carries the raw token; only its
// SHA-256 is stored, so a database leak hands out no usable invites.
export const invites = sqliteTable(
  "invites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").notNull().default("user"),
    displayName: text("display_name"),
    invitedBy: text("invited_by").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    acceptedUserId: text("accepted_user_id"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_invites_email").on(table.email)],
);

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
export type BudgetPlan = typeof budgetPlans.$inferSelect;
export type NewBudgetPlan = typeof budgetPlans.$inferInsert;
export type BudgetLedgerRow = typeof budgetLedger.$inferSelect;
export type NewBudgetLedgerRow = typeof budgetLedger.$inferInsert;
export type BudgetLedgerJob = typeof budgetLedgerJobs.$inferSelect;
export type RecurringTransaction = typeof recurringTransactions.$inferSelect;
export type NewRecurringTransaction = typeof recurringTransactions.$inferInsert;
export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
export type ReimbursementLink = typeof reimbursementLinks.$inferSelect;
export type NewReimbursementLink = typeof reimbursementLinks.$inferInsert;
export type TransactionGroup = typeof transactionGroups.$inferSelect;
export type NewTransactionGroup = typeof transactionGroups.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type Passkey = typeof passkey.$inferSelect;
export type UserPin = typeof userPin.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
export type StatReset = typeof statResets.$inferSelect;
export type NewStatReset = typeof statResets.$inferInsert;
