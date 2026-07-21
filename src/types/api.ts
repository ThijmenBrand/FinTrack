export interface Account {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
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
  kind: "spending" | "reserved";
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
  type: "income" | "expense" | "internal_transfer" | "reimbursement" | "reserved";
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
  createdAt: string;
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
  type: "income" | "expense" | "internal_transfer" | "reimbursement" | "reserved";
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
  reservedTotal: number;
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
  createdAt: string;
}

export interface AdminUser {
  id: string;
  username: string;
  displayUsername: string;
  isAdmin: boolean;
  createdAt: string;
  lastActive: string | null;
  accountCount: number;
  transactionCount: number;
  hasPin: boolean;
  passkeyCount: number;
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

export interface ReservedCategory {
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  funded: number;
  target: number | null;
}

export interface BudgetData {
  monthlyIncome: number;
  totalFixedCosts: number;
  totalReserved: number;
  availableToAllocate: number;
  totalAllocated: number;
  unallocated: number;
  totalBudget: number;
  totalSpentThisMonth: number;
  unbudgetedSpending: UnbudgetedSpending[];
  fixedCosts: FixedCost[];
  allocations: Allocation[];
  reserved: ReservedCategory[];
  suggestions: BudgetSuggestion[];
  automation: AutomationState;
  categoryAverages: Record<string, number>;
  month: { from: string; to: string; label: string };
}

export interface UserPreferencesData {
  autoBudgetEnabled: boolean;
  autoBudgetIntervalMonths: number;
  autoBudgetLookbackMonths: number;
  lastAutoBudgetCheckAt: string | null;
  financialMonthStartDay: number;
  defaultAccountId: string | null;
}

export interface BalanceTimelineData {
  historical: { date: string; balance: number }[];
  projected: { date: string; balance: number }[];
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
  summary: {
    totalIncome: number;
    totalExpenses: number;
    net: number;
    txCount: number;
  };
  topMerchants: {
    description: string;
    total: number;
    count: number;
  }[];
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
