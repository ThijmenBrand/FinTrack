import type { Locale } from "@/lib/i18n";

/** A share member's standing on an account; "owner" only appears synthesized. */
export type AccountRole = "owner" | "editor" | "viewer";

export interface Account {
  id: string;
  /** The OWNER's user id — the space this account's rows and categories live in. */
  userId: string;
  name: string;
  type: string;
  bankName: string | null;
  bank: string | null;
  iban: string | null;
  currency: string;
  initialBalance: number;
  currentBalance: number;
  transactionTotal: number;
  /** The budget plan this account belongs to; null = not in any budget. */
  budgetId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The caller's standing on this account. "owner" for the user's own accounts. */
  role: AccountRole;
  /** Display name of the sharing owner; null for the user's own accounts. */
  ownerName: string | null;
  /** Profile picture of the sharing owner; null for the user's own accounts. */
  ownerImage: string | null;
  /** People this account is shared with (pending invites included); 0 unless you own it. */
  sharedWith: number;
  /** Faces for the shared badge — one per live invite; empty unless you own it. */
  sharedWithUsers: SharedWithUser[];
}

/** A person an account is shared with. Name/image are null until they accept. */
export interface SharedWithUser {
  name: string | null;
  image: string | null;
  email: string | null;
}

/** One row of GET /api/accounts/{id}/members — the synthesized owner, then invited members. */
export interface AccountMember {
  id: string;
  email: string | null;
  role: AccountRole;
  status: "pending" | "accepted" | "expired";
  memberName: string | null;
  memberImage: string | null;
  createdAt: string;
  /** True on the caller's own membership row; absent on the owner entry. */
  isMe?: boolean;
}

/**
 * Which side of the budget a category belongs to. "transfer" is neither: money
 * moving between your own accounts is budgeted on no side at all.
 */
export type CategoryKind = "income" | "expense" | "transfer";

export interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  kind: CategoryKind;
}

export interface CategoryWithDetails extends Category {
  /** Owner of the category; only your own ids are valid on your own rows. */
  userId: string;
  createdAt: string;
  transactionCount: number;
  rules: CategoryRule[];
}

export interface CategoryRule {
  id: string;
  pattern: string;
  categoryId: string;
  matchType: string;
  matchField: string;
  isActive: boolean;
  createdAt: string;
}

export interface RuleWithCategory {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  matchType: string;
  matchField: string;
  isActive: boolean;
  createdAt: string;
}

/** One line of a split rule as the /api/split-rules list returns it. */
export interface SplitRuleLineWithCategory {
  id: string;
  ruleId: string;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  /** Percentage mode: this line's share of the amount. */
  percentage: number | null;
  /** Fixed mode: this line's fixed amount; null on the remainder line. */
  amount: number | null;
  isRemainder: boolean;
  sortOrder: number;
}

export interface SplitRuleWithLines {
  id: string;
  pattern: string;
  matchType: string;
  matchField: string;
  mode: "percentage" | "fixed";
  isActive: boolean;
  createdAt: string;
  lines: SplitRuleLineWithCategory[];
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName: string | null;
  date: string;
  name: string | null;
  description: string;
  amount: number;
  balance: number | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  type: "income" | "expense" | "internal_transfer" | "reimbursement";
  linkedTransactionId: string | null;
  linkedAccountName: string | null;
  reimbursesTransactionId: string | null;
  reimbursesDescription: string | null;
  effectiveAmount: number;
  reimbursementCount: number;
  reimbursedTotal: number;
  groupId: string | null;
  groupName: string | null;
  recurringTransactionId: string | null;
  recurringDescription: string | null;
  /** Who created/last edited the row; non-null only on shared accounts (null created_by = the owner). */
  createdByName: string | null;
  createdByImage: string | null;
  /** True when the caller created the row — lists skip the byline, the detail dialog keeps it. */
  createdBySelf?: boolean;
  modifiedByName: string | null;
  notes: string | null;
  isManual: boolean;
  importBatchId: string | null;
  createdAt: string;
  /** Set on a split child; null on normal rows and on the split parent itself. */
  parentTransactionId: string | null;
  /** True on a split's pure-wrapper parent row — it carries no category of its own. */
  isSplitParent: boolean;
  /** A split parent's children, joined the same as top-level rows. Absent/undefined on non-parents. */
  splits?: Transaction[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Pot {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  netAmount: number;
  transactionCount: number;
  targetAmount: number | null;
  targetDate: string | null;
  fundedAmount: number;
  archivedAt: string | null;
  createdAt: string;
}

// A pot's net over the currently filtered range, as opposed to `Pot.netAmount`
// which is lifetime. `isPartial` means the range excludes some pot members.
export interface PotRangeTotal {
  groupId: string;
  net: number;
  /** Members inside the range; both counts exclude internal transfers. */
  memberCount: number;
  totalMemberCount: number;
  isPartial: boolean;
}

export interface UpcomingSpike {
  id: string;
  name: string;
  categoryName: string | null;
  categoryColor: string | null;
  targetAmount: number;
  targetDate: string;
  fundedAmount: number;
  remaining: number;
  paydaysRemaining: number;
  suggestedAllocation: number;
  daysUntil: number;
}

export type SpikeImpactStatus = "fits" | "tight" | "over";

export interface ThisMonthSpike extends UpcomingSpike {
  freeAfter: number;
  status: SpikeImpactStatus;
  categoryWarning: string | null;
}

export type SpikeOnTrack = "ahead" | "on_pace" | "behind";

export interface SavingTowardSpike extends UpcomingSpike {
  expectedFundedByNow: number;
  onTrack: SpikeOnTrack;
}

export interface PotAllocationEvent {
  date: string;
  delta: number;
  fundedAfter: number;
}

export interface PotLinkedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "internal_transfer" | "reimbursement";
  categoryName: string | null;
  categoryColor: string | null;
}

export interface PotSpikeStats {
  daysUntil: number;
  paydaysRemaining: number;
  suggestedAllocation: number;
  expectedFundedByNow: number;
  onTrack: SpikeOnTrack;
  paydaySchedule: { date: string; expectedFunded: number }[];
}

export interface PotDetails {
  pot: Pot;
  spike: PotSpikeStats | null;
  allocations: PotAllocationEvent[];
  transactions: PotLinkedTransaction[];
}

export interface MonthMoneyView {
  monthlyIncome: number;
  totalFixedCosts: number;
  spentThisMonth: number;
  freeToSpend: number;
  freeToSpendAfterSpikes: number;
  upcomingThisMonthTotal: number;
  hasIncome: boolean;
  thisMonthSpikes: ThisMonthSpike[];
}

export interface Profile {
  id: string;
  displayName: string;
  /** Profile picture URL; null falls back to initials. */
  imageUrl: string | null;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  displayName: string;
  imageUrl: string | null;
  email: string;
  emailVerified: boolean;
  role: "admin" | "user";
  isAdmin: boolean;
  isCurrentUser: boolean;
  createdAt: string;
  lastActive: string | null;
  accountCount: number;
  transactionCount: number;
  hasPin: boolean;
  passkeyCount: number;
  banned: boolean;
  banReason: string | null;
}

export interface Invite {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface RecurringTx {
  id: string;
  accountId: string;
  accountName: string | null;
  description: string;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  nextOccurrence: string | null;
}

export interface ForecastData {
  currentBalance: number;
  monthlyRecurringIncome: number;
  monthlyRecurringExpenses: number;
  monthlyNet: number;
  monthlyForecast: {
    month: string;
    label: string;
    income: number;
    expenses: number;
    net: number;
    endBalance: number;
  }[];
  upcomingPayments: {
    date: string;
    description: string;
    amount: number;
    type: string;
    categoryName: string | null;
    categoryColor: string | null;
    source?: "recurring" | "spike";
  }[];
  advice: { type: "info" | "warning" | "success"; message: string }[];
}

export interface FixedCost {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  monthlyAmount: number;
  spent: number;
  avgMonthly: number;
  avgMonths: number;
  items: { description: string; monthlyAmount: number }[];
}

/**
 * One income category as a budget line: what the recurring plans behind it
 * expect this period, and what actually landed.
 *
 * The mirror image of FixedCost — an income category is planned and then
 * reconciled the same way a fixed cost is, so the row can be read the same
 * way. What differs is the direction: `received` above `expected` is good
 * news, not an overspend.
 */
export interface IncomeLine {
  /** "uncategorized" for plans with no category, same as FixedCost. */
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  /** Monthly-equivalent of the active recurring income plans in this category. */
  expected: number;
  /** Income transactions in this category, this period, in the plan's accounts. */
  received: number;
  /** Mean actually received per month since the stats cutoff. */
  avgMonthly: number;
  avgMonths: number;
  items: { description: string; monthlyAmount: number }[];
  /** Year-scope figures; present only for a yearly plan. */
  year?: { expected: number; received: number };
}

export interface BudgetSubLine {
  id: string;
  parentId: string | null;
  name: string;
  amount: number;
  children: BudgetSubLine[];
  /** Present when this line is a recurring plan expressed monthly. */
  recurring?: {
    id: string;
    amount: number;
    frequency: "weekly" | "biweekly" | "monthly" | "yearly";
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    monthOfYear: number | null;
    startDate: string;
    isActive: boolean;
  };
}

export interface Allocation {
  id: string;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  amount: number;
  spent: number;
  remaining: number;
  percentage: number;
  status: "ok" | "warning" | "exceeded";
  avgMonthly: number;
  avgMonths: number;
  subLines: BudgetSubLine[];
}

export interface BudgetSuggestion {
  id: string;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  suggestedAmount: number;
  currentAmount: number | null;
  avgMonthly: number;
  monthsOfData: number;
  generatedAt: string | null;
}

export interface AutomationState {
  enabled: boolean;
  intervalMonths: number;
  lookbackMonths: number;
  lastCheckAt: string | null;
  regenerationDue: boolean;
}

export interface UnbudgetedSpending {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  spent: number;
}

export type BudgetPlanPeriod = "monthly" | "yearly";
/** How a shared budget's cost split is read: proportions, or euros per period. */
export type SplitMode = "percent" | "amount";

/** How a category's yearly envelope is doing — see budget-ledger.ts. */
export type EnvelopeStatus = "ok" | "month-over" | "year-over";

/** One month of a yearly envelope, as stored in the ledger. */
export interface LedgerMonthView {
  monthIndex: number;
  from: string;
  to: string;
  closed: boolean;
  target: number;
  spent: number;
  rolloverIn: number;
  rolloverOut: number;
  /** `target + rolloverIn` — what this month may actually spend. */
  allowance: number;
}

export interface YearlyCategoryView {
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  annualAmount: number;
  monthTarget: number;
  rolloverIn: number;
  allowance: number;
  spentMonth: number;
  spentYear: number;
  remainingYear: number;
  status: EnvelopeStatus;
  months: LedgerMonthView[];
}

export interface AnnualIncomeView {
  actual: number;
  projected: number;
  total: number;
  monthsBanked: number;
  monthsProjected: number;
}

/** Present only for yearly plans; the whole carry-over view of one year. */
export interface YearlyBudgetView {
  year: number;
  monthIndex: number;
  from: string;
  to: string;
  monthFrom: string;
  monthTo: string;
  income: AnnualIncomeView;
  totals: {
    annualPot: number;
    spentYear: number;
    remainingYear: number;
    allowanceThisMonth: number;
    spentThisMonth: number;
    rolloverIntoThisMonth: number;
  };
  categories: YearlyCategoryView[];
}

export interface BudgetData {
  /** The plan these numbers are scoped to; null for pre-plan users. */
  plan: {
    id: string;
    name: string;
    isMain: boolean;
    period: BudgetPlanPeriod;
    role: AccountRole;
    ownerName: string | null;
  } | null;
  /** Null unless the plan is yearly. */
  yearly: YearlyBudgetView | null;
  monthlyIncome: number;
  totalFixedCosts: number;
  availableToAllocate: number;
  totalAllocated: number;
  unallocated: number;
  totalBudget: number;
  totalSpentThisMonth: number;
  unbudgetedSpending: UnbudgetedSpending[];
  fixedCosts: FixedCost[];
  /** The income side of the list: one line per income category. */
  incomeLines: IncomeLine[];
  allocations: Allocation[];
  suggestions: BudgetSuggestion[];
  automation: AutomationState;
  categoryAverages: Record<string, number>;
  /** Active statistics reset date; every avgMonthly counts from it. */
  statsCutoff: string | null;
  month: { from: string; to: string; label: string };
}

/** A named budget: owns accounts (exclusive) and per-category allocations. */
export interface BudgetPlanData {
  id: string;
  name: string;
  isMain: boolean;
  period: BudgetPlanPeriod;
  /** First financial month the yearly envelope covers; null while monthly. */
  periodStartedAt: string | null;
  /**
   * Cost-split key for a shared budget: the whole percent the plan's OWNER
   * carries. Display-only; meaningless (and hidden) while none of the plan's
   * accounts are shared.
   */
  ownerSharePercent: number;
  /** The rest of the key: percent per member, keyed by invite email. Empty on plans you don't own. */
  sharePercents: Record<string, number>;
  /** The CALLER's own percent of this plan — resolved server-side. */
  sharePercent: number;
  /**
   * Which unit the key is read in. "amount" swaps the four percentages above
   * for the four fields below: everyone's euros per period, with whoever has
   * none set carrying whatever the fixed shares leave.
   */
  splitMode: SplitMode;
  /** Euros per period the OWNER carries; null means they carry the rest. */
  ownerShareAmount: number | null;
  /** Euros per member, keyed by invite email; null means the rest. Empty on plans you don't own. */
  shareAmounts: Record<string, number | null>;
  /** The CALLER's own euros; null means they carry the rest. */
  shareAmount: number | null;
  /**
   * Everyone else on a plan you don't own, as one anonymous total: their
   * addresses are not yours to see, but without their fixed euros the rest
   * you carry can't be worked out.
   */
  others: { fixedAmount: number; restCount: number };
  createdAt: string;
  accounts: { id: string; name: string; type: string }[];
  /** "owner" for the user's own plans; "editor"/"viewer" for plans reached through a shared account. */
  role: AccountRole;
  /** Display name of the sharing owner; null for the user's own plans. */
  ownerName: string | null;
}

export interface UserPreferencesData {
  autoBudgetEnabled: boolean;
  autoBudgetIntervalMonths: number;
  autoBudgetLookbackMonths: number;
  lastAutoBudgetCheckAt: string | null;
  financialMonthStartDay: number;
  defaultAccountId: string | null;
  hideInternalTransfers: boolean;
  /** Envelope-style: count transfers between budgets as spending/income in per-budget views. */
  countCrossBudgetTransfers: boolean;
  /** UI language — see LOCALES in @/lib/i18n. */
  locale: Locale;
  /** Simple mode: hide advanced features on dashboard, budgets and insights. */
  simpleMode: boolean;
  /** A shared plan chosen as the dashboard budget; null = the user's own main plan. */
  mainBudgetPlanId: string | null;
}

/** A dated line in the sand after which averages start counting again. */
export interface StatResetData {
  id: string;
  date: string;
  note: string | null;
  createdAt: string;
}

export interface BalanceTimelineData {
  historical: { date: string; balance: number }[];
  currentBalance: number;
  accountName: string | null;
}

export interface InsightsData {
  categoryBreakdown: {
    categoryId: string | null;
    categoryName: string;
    categoryColor: string;
    total: number;
    count: number;
  }[];
  dailyTotals: { date: string; income: number; expenses: number }[];
  monthlyTotals: {
    month: string;
    income: number;
    expenses: number;
  }[];
  /** Month × category expense matrix (pot spending included, cells clamped at 0). */
  monthlyCategoryTotals: {
    month: string;
    categoryId: string | null;
    total: number;
  }[];
  summary: {
    totalIncome: number;
    totalExpenses: number;
    net: number;
    txCount: number;
  };
  /**
   * Totals for the preceding period of equal length (for vs-previous deltas).
   * Null when the request doesn't include a previous range (e.g. All Time) or
   * when that period predates the statistics reset.
   * categoryTotals keys are categoryId, or "none" for uncategorized.
   */
  previous: {
    totalIncome: number;
    totalExpenses: number;
    net: number;
    categoryTotals: Record<string, number>;
  } | null;
  /** Active statistics reset date, or null when none is set. */
  statsCutoff: string | null;
  /** True when `previous` was withheld because it predates the reset. */
  previousPredatesReset: boolean;
  topMerchants: {
    description: string;
    total: number;
    count: number;
  }[];
}

/** Flow graph of income sources → accounts → spending, plus transfers. */
export interface MoneyFlowData {
  nodes: {
    id: string;
    name: string;
    kind: "income" | "account" | "category";
    color: string;
  }[];
  links: { source: string; target: string; value: number }[];
}

export interface ReimbursementDetail {
  id: string;
  date: string;
  description: string;
  amount: number;
}

export interface HistoryData {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  currentBudgetAmount: number;
  months: {
    month: string;
    label: string;
    spent: number;
    transactionCount: number;
    percentage: number;
    status: "ok" | "warning" | "exceeded";
    isCurrent: boolean;
  }[];
}

export interface ImportBatch {
  id: string;
  accountName: string;
  fileName: string;
  transactionCount: number;
  importedAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  displayName: string | null;
  category: "auth" | "data" | "admin";
  action: string;
  targetId: string | null;
  targetType: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  userId?: string;
  category?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  pagination: Pagination;
}
