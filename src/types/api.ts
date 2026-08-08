export interface Account {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  bank: string | null;
  iban: string | null;
  currency: string;
  initialBalance: number;
  currentBalance: number;
  transactionTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface CategoryWithDetails extends Category {
  createdAt: string;
  transactionCount: number;
  rules: CategoryRule[];
}

export interface CategoryRule {
  id: string;
  pattern: string;
  categoryId: string;
  matchType: string;
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
  isActive: boolean;
  createdAt: string;
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
  notes: string | null;
  isManual: boolean;
  importBatchId: string | null;
  createdAt: string;
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
  username: string;
  displayUsername: string;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  username: string;
  displayUsername: string;
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

export interface BudgetData {
  monthlyIncome: number;
  totalFixedCosts: number;
  availableToAllocate: number;
  totalAllocated: number;
  unallocated: number;
  totalBudget: number;
  totalSpentThisMonth: number;
  unbudgetedSpending: UnbudgetedSpending[];
  fixedCosts: FixedCost[];
  allocations: Allocation[];
  suggestions: BudgetSuggestion[];
  automation: AutomationState;
  categoryAverages: Record<string, number>;
  /** Active statistics reset date; every avgMonthly counts from it. */
  statsCutoff: string | null;
  month: { from: string; to: string; label: string };
}

export interface UserPreferencesData {
  autoBudgetEnabled: boolean;
  autoBudgetIntervalMonths: number;
  autoBudgetLookbackMonths: number;
  lastAutoBudgetCheckAt: string | null;
  financialMonthStartDay: number;
  defaultAccountId: string | null;
  hideInternalTransfers: boolean;
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
  username: string | null;
  displayUsername: string | null;
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
