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
  createdAt: string;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
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

export interface BudgetData {
  monthlyIncome: number;
  totalFixedCosts: number;
  availableToAllocate: number;
  totalAllocated: number;
  unallocated: number;
  fixedCosts: FixedCost[];
  allocations: Allocation[];
  categoryAverages: Record<string, number>;
  month: { from: string; to: string; label: string };
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

export interface PreviewTransaction {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  counterpartyIban: string | null;
  suggestedCategory: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryColor: string | null;
  isTransfer: boolean;
  isDuplicate: boolean;
  include: boolean;
}
