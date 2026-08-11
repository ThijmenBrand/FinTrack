import { getI18n } from "@/lib/i18n/server";
import { cache } from "react";
import { db } from "@/db";
import {
  accounts,
  budgetPlans,
  transactions,
  budgets,
  categories,
  recurringTransactions,
  transactionGroups,
} from "@/db/schema";
import { eq, and, asc, gte, lte, sql, sum, inArray, isNotNull, notInArray } from "drizzle-orm";
import { defaultCategoryNames, TRANSFER_CATEGORY } from "@/lib/default-categories";
import {
  accountScopeFilter,
  resolveBudgetPlan,
  type ResolvedBudgetPlan,
} from "@/lib/budget-plan";
import { currentFinancialSlot } from "@/lib/financial-year";
import { readLedgerYear } from "@/lib/budget-ledger-db";
import { getPaySchedule, paydaysBetween, type PaySchedule } from "@/lib/pay-schedule";
import { getMonthMoneyMath, toMonthly } from "@/lib/month-money";
import { classifyOnTrack } from "@/lib/on-track";
import { getFinancialMonthRange, getPeriodProgress } from "@/lib/financial-month";
import { formatCurrency, toIsoDate } from "@/lib/utils";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import type {
  MonthMoneyView,
  SavingTowardSpike,
  SpikeImpactStatus,
  ThisMonthSpike,
  UpcomingSpike,
} from "@/types/api";

// ─── Helpers ────────────────────────────────────────────────────────

export function getPeriodRange(
  period: string,
  startDay: number = 1,
): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  switch (period) {
    case "daily": {
      const iso = toIsoDate(new Date(y, m, d));
      return { from: iso, to: iso };
    }
    case "weekly": {
      const off = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(y, m, d + off);
      const sun = new Date(mon);
      sun.setDate(sun.getDate() + 6);
      return { from: toIsoDate(mon), to: toIsoDate(sun) };
    }
    case "monthly": {
      return getFinancialMonthRange(now, startDay);
    }
    case "yearly":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default:
      return { from: "2000-01-01", to: "2099-12-31" };
  }
}

function getDateRanges(startDay: number = 1) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  // Fraction of the financial month elapsed, including today.
  const {
    from: monthStart,
    to: monthEnd,
    progress: monthProgress,
  } = getPeriodProgress(now, startDay);

  const weekOff = dow === 0 ? -6 : 1 - dow;
  const weekStart = toIsoDate(new Date(y, m, d + weekOff));
  const weekEnd = toIsoDate(new Date(y, m, d + weekOff + 6));

  const lastWeekStart = toIsoDate(new Date(y, m, d + weekOff - 7));
  const lastWeekEnd = toIsoDate(new Date(y, m, d + weekOff - 1));

  return {
    monthStart,
    monthEnd,
    weekStart,
    weekEnd,
    lastWeekStart,
    lastWeekEnd,
    monthProgress,
  };
}

/**
 * The rows {@link defaultScopeAccountIds} needs to pick the dashboard's
 * default scope. Fetched separately from preferences so the page can run
 * both queries in parallel — the query itself doesn't depend on prefs.
 */
export const getScopeAccountRows = cache(async (userId: string) =>
  db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.userId, userId)),
);

/** The user's main budget plan with its account ids. Cached per render pass. */
export const getMainPlan = cache(async (userId: string) =>
  resolveBudgetPlan(userId, null),
);

/** All budget plans, oldest first — drives the budget card's switcher. */
export const getUserPlans = cache(async (userId: string) =>
  db
    .select({
      id: budgetPlans.id,
      name: budgetPlans.name,
      isMain: budgetPlans.isMain,
    })
    .from(budgetPlans)
    .where(eq(budgetPlans.userId, userId))
    .orderBy(asc(budgetPlans.createdAt)),
);

/**
 * Expand the scoped accounts to the set whose activity should count toward
 * "your" spending: the scoped accounts themselves, plus any account that
 * received an `internal_transfer` paired with an outflow on one of them during
 * the period.
 *
 * This handles the cross-account spending case: when the user transfers €X
 * from their main account to a secondary account and then spends from the
 * secondary, that spending was funded from the scoped accounts and should
 * still appear in the account-scoped Expenses / Free to Spend tiles.
 *
 * Returns `undefined` (meaning "no scoping") when the scope is empty.
 *
 * Cached per render pass: three dashboard cards ask for the same window, and
 * against a remote DB the duplicate round trips are pure waste.
 */
const getFundedAccountIds = cache(async (
  userId: string,
  scopeAccountIds: string[] | undefined,
  from: string,
  to: string,
): Promise<string[] | undefined> => {
  if (!scopeAccountIds || scopeAccountIds.length === 0) return undefined;
  const rows = await db
    .select({ destAccountId: transactions.accountId })
    .from(transactions)
    .innerJoin(
      sql`transactions src`,
      sql`src.id = ${transactions.linkedTransactionId}
          AND src.user_id = ${userId}
          AND ${inArray(sql`src.account_id`, scopeAccountIds)}
          AND src.amount < 0
          AND src.date >= ${from} AND src.date <= ${to}`,
    )
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "internal_transfer"),
        sql`${transactions.amount} > 0`,
      ),
    );
  const set = new Set<string>(scopeAccountIds);
  for (const r of rows) if (r.destAccountId) set.add(r.destAccountId);
  return Array.from(set);
});

interface CategorySpend {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  spent: number;
}

/**
 * Pot spending in a window, netted per pot (so a pot that took in more than it
 * spent contributes 0) and rolled up by the category assigned to the *pot* —
 * not to its member transactions. Same rule as /api/budgets and the Free to
 * Spend math, so a pot with a category lands in that category's budget instead
 * of an "Into pots" catch-all. Pots without a category come back under a `null`
 * categoryId.
 */
async function getPotSpendByCategory(
  userId: string,
  from: string,
  to: string,
  scopeAccountIds?: string[],
): Promise<CategorySpend[]> {
  const scope = accountScopeFilter(scopeAccountIds);
  const rows = await db
    .select({
      categoryId: transactionGroups.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      total: sql<number>`${potSpentAmount()}`,
    })
    .from(transactionGroups)
    .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
    .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
    .where(
      and(
        eq(transactionGroups.userId, userId),
        sql`${transactions.type} != 'internal_transfer'`,
        gte(transactions.date, from),
        lte(transactions.date, to),
        ...(scope ? [scope] : []),
      ),
    )
    .groupBy(transactionGroups.id, transactionGroups.categoryId);

  const { t } = await getI18n();
  const byCategory = new Map<string, CategorySpend>();
  for (const r of rows) {
    const key = r.categoryId ?? "";
    const existing = byCategory.get(key);
    if (existing) {
      existing.spent += Number(r.total) || 0;
      continue;
    }
    byCategory.set(key, {
      categoryId: r.categoryId,
      categoryName: r.categoryId ? r.categoryName : t("dashboard.intoPots"),
      categoryColor: r.categoryColor,
      categoryIcon: r.categoryId ? r.categoryIcon : "PiggyBank",
      spent: Number(r.total) || 0,
    });
  }
  return Array.from(byCategory.values());
}

/**
 * The "Not budgeted" list: transaction spending and pot spending in categories
 * that have no budget, merged so a category appearing in both shows one row.
 */
function mergeUnbudgeted(
  txByCategory: CategorySpend[],
  potByCategory: CategorySpend[],
  budgetedCategoryIds: Set<string>,
): CategorySpend[] {
  const out = new Map<string, CategorySpend>();
  // Uncategorized transactions and category-less pots stay distinct buckets,
  // hence the different fallback keys.
  const add = (rows: CategorySpend[], noCategoryKey: string) => {
    for (const r of rows) {
      if (r.categoryId && budgetedCategoryIds.has(r.categoryId)) continue;
      const existing = out.get(r.categoryId ?? noCategoryKey);
      if (existing) existing.spent += r.spent;
      else out.set(r.categoryId ?? noCategoryKey, { ...r });
    }
  };
  add(txByCategory, "uncategorized");
  add(potByCategory, "pots");
  return Array.from(out.values())
    .filter((r) => r.spent !== 0)
    .sort((a, b) => b.spent - a.spent);
}

// ─── Per-widget queries ─────────────────────────────────────────────

/**
 * This month's spendable amount per category for a yearly plan: the ledger's
 * `target + rolloverIn`. Null for monthly plans, where the allocation itself
 * is the cap, and for a yearly plan whose ledger has not been built yet — in
 * both cases callers fall back to the stored monthly amount.
 */
async function yearlyAllowances(
  userId: string,
  plan: ResolvedBudgetPlan | null,
  startDay: number,
): Promise<Map<string, number> | null> {
  if (plan?.period !== "yearly") return null;
  const slot = currentFinancialSlot(startDay);
  const ledger = await readLedgerYear(userId, plan.id, slot.year);
  if (ledger.length === 0) return null;

  const out = new Map<string, number>();
  for (const { categoryId, months } of ledger) {
    const month = months.find((m) => m.monthIndex === slot.monthIndex);
    if (month) out.set(categoryId, month.allowance);
  }
  return out;
}

export const getBudgetOverview = cache(async (
  userId: string,
  startDay: number = 1,
  planId?: string,
) => {
  // Scoped to one budget plan: its allocations and its accounts' spending.
  // No explicit planId → the main plan (what the dashboard shows). Users
  // without plans fall back to the legacy unscoped view.
  const plan =
    planId === undefined
      ? await getMainPlan(userId)
      : await resolveBudgetPlan(userId, planId);
  const scopeAccountIds = plan ? plan.accountIds : undefined;
  const txScope = accountScopeFilter(scopeAccountIds);
  const recurringScope =
    scopeAccountIds === undefined
      ? undefined
      : scopeAccountIds.length > 0
        ? inArray(recurringTransactions.accountId, scopeAccountIds)
        : sql`1=0`;
  const { monthStart, monthEnd, monthProgress } = getDateRanges(startDay);

  const [allBudgets, recurringExpenses, monthByCategory, monthPotSpend] =
    await Promise.all([
      db
        .select({
          id: budgets.id,
          categoryId: budgets.categoryId,
          categoryName: categories.name,
          categoryColor: categories.color,
          categoryIcon: categories.icon,
          amount: budgets.amount,
          period: budgets.period,
        })
        .from(budgets)
        .leftJoin(categories, eq(budgets.categoryId, categories.id))
        .where(
          and(
            eq(budgets.isActive, true),
            eq(budgets.status, "active"),
            eq(budgets.userId, userId),
            ...(plan ? [eq(budgets.budgetId, plan.id)] : []),
          ),
        ),

      db
        .select({
          categoryId: recurringTransactions.categoryId,
          amount: recurringTransactions.amount,
          frequency: recurringTransactions.frequency,
        })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.type, "expense"),
            eq(recurringTransactions.isActive, true),
            eq(recurringTransactions.userId, userId),
            ...(recurringScope ? [recurringScope] : []),
          ),
        ),

      // Every expense in the financial month, split by category. Sums to the
      // headline total, and the categories without a budget are what the
      // "Not budgeted" list shows.
      db
        .select({
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          categoryColor: categories.color,
          categoryIcon: categories.icon,
          total: sql<number>`sum(${effectiveExpenseAmount()})`,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            ...(txScope ? [txScope] : []),
          ),
        )
        .groupBy(transactions.categoryId),

      getPotSpendByCategory(userId, monthStart, monthEnd, scopeAccountIds),
    ]);

  // Per-budgeted-category spending — drives the per-category chips.
  const budgetsByPeriod = new Map<string, typeof allBudgets>();
  for (const b of allBudgets) {
    const existing = budgetsByPeriod.get(b.period) || [];
    existing.push(b);
    budgetsByPeriod.set(b.period, existing);
  }

  const spendingByCategory = new Map<string, number>();
  await Promise.all(
    Array.from(budgetsByPeriod.entries()).map(
      async ([period, periodBudgets]) => {
        const { from, to } = getPeriodRange(period, startDay);
        const categoryIds = periodBudgets.map((b) => b.categoryId);
        const budgeted = new Set(categoryIds);

        // Monthly budgets can reuse the month-wide queries above instead of
        // re-running them — same range, same expense math, just unfiltered by
        // category. Saves a serial round-trip wave on the common path.
        if (period === "monthly") {
          for (const r of monthByCategory) {
            if (r.categoryId && budgeted.has(r.categoryId)) {
              spendingByCategory.set(r.categoryId, Number(r.total) || 0);
            }
          }
          for (const p of monthPotSpend) {
            if (!p.categoryId || !budgeted.has(p.categoryId)) continue;
            spendingByCategory.set(
              p.categoryId,
              (spendingByCategory.get(p.categoryId) ?? 0) + p.spent,
            );
          }
          return;
        }

        const [results, potSpend] = await Promise.all([
          db
            .select({
              categoryId: transactions.categoryId,
              total: sql<number>`sum(${effectiveExpenseAmount()})`,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, userId),
                inArray(transactions.categoryId, categoryIds),
                eq(transactions.type, "expense"),
                sql`${transactions.groupId} IS NULL`,
                gte(transactions.date, from),
                lte(transactions.date, to),
                ...(txScope ? [txScope] : []),
              )
            )
            .groupBy(transactions.categoryId),
          getPotSpendByCategory(userId, from, to, scopeAccountIds),
        ]);
        for (const r of results) {
          if (r.categoryId) {
            spendingByCategory.set(r.categoryId, r.total || 0);
          }
        }
        for (const p of potSpend) {
          if (!p.categoryId || !budgeted.has(p.categoryId)) continue;
          spendingByCategory.set(
            p.categoryId,
            (spendingByCategory.get(p.categoryId) ?? 0) + p.spent,
          );
        }
      }
    )
  );

  // On a yearly plan a category's cap this month is not a flat twelfth: it is
  // its share plus whatever the earlier months of the year left behind. Using
  // the ledger's allowance keeps these bars agreeing with the budgets page —
  // otherwise the dashboard would call a month "over" that the envelope is
  // comfortably funding out of earlier savings.
  const allowanceByCategory = await yearlyAllowances(userId, plan, startDay);

  const budgetItems = allBudgets
    .map((b) => {
      const spent = spendingByCategory.get(b.categoryId) || 0;
      const limit = allowanceByCategory?.get(b.categoryId) ?? b.amount;
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      return {
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        categoryColor: b.categoryColor,
        categoryIcon: b.categoryIcon,
        period: b.period,
        spent,
        limit,
        percentage: Math.round(pct),
        status: (pct >= 100
          ? "exceeded"
          : pct >= 80
            ? "warning"
            : "ok") as "ok" | "warning" | "exceeded",
      };
    })
    .sort((a, b) => b.percentage - a.percentage);

  // Headline totals treat recurring fixed costs as part of the budget too —
  // money is still flowing out, so a "budget spent vs. budget total" bar
  // should reflect both committed envelopes and recurring bills. `spent`
  // counts every expense (and net pot outflow) in the period, not just
  // spending in budgeted categories.
  const totalAllocated = allBudgets.reduce(
    (s, b) => s + (allowanceByCategory?.get(b.categoryId) ?? b.amount),
    0,
  );
  const totalFixedCosts = recurringExpenses.reduce(
    (s, r) => s + toMonthly(r.amount, r.frequency),
    0,
  );
  const totalBudgeted = totalAllocated + totalFixedCosts;

  const txTotal = monthByCategory.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const potExpense = monthPotSpend.reduce((s, r) => s + r.spent, 0);
  const totalBudgetSpent = txTotal + potExpense;

  // The gap between the headline and the bars: spending in categories with no
  // budget (incl. uncategorized), plus pots that have no category of their own.
  // A category with an active recurring expense is already budgeted as a fixed
  // cost. The Budgets page keeps those out of manual allocations, so treating
  // them as unbudgeted here made the dashboard contradict that page.
  const budgetedCategoryIds = new Set(allBudgets.map((b) => b.categoryId));
  for (const fixedCost of recurringExpenses) {
    if (fixedCost.categoryId) budgetedCategoryIds.add(fixedCost.categoryId);
  }
  const unbudgetedItems = mergeUnbudgeted(
    monthByCategory.map((r) => ({
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
      categoryIcon: r.categoryIcon,
      spent: Number(r.total) || 0,
    })),
    monthPotSpend,
    budgetedCategoryIds,
  );

  return {
    plan: plan ? { id: plan.id, name: plan.name, isMain: plan.isMain } : null,
    budgetItems,
    unbudgetedItems,
    unbudgetedTotal: unbudgetedItems.reduce((s, r) => s + r.spent, 0),
    totalBudgeted,
    totalBudgetSpent,
    monthProgress,
  };
});

export type BudgetOverview = Awaited<ReturnType<typeof getBudgetOverview>>;

export const getAccountBalances = cache(async (userId: string) => {
  const accountBalanceRows = await db
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: accounts.name,
      type: accounts.type,
      bank: accounts.bank,
      bankName: accounts.bankName,
      iban: accounts.iban,
      currency: accounts.currency,
      initialBalance: accounts.initialBalance,
      sortOrder: accounts.sortOrder,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
      txTotal: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(accounts.id, transactions.accountId))
    .where(eq(accounts.userId, userId))
    .groupBy(accounts.id);

  return accountBalanceRows.map((row) => ({
    ...row,
    currentBalance: row.initialBalance + Number(row.txTotal),
  }));
});

/**
 * Balance history per account, walked backwards from today's balance.
 * Sampled weekly — the dashboard card is small and 6 months of daily points per
 * account is a lot of payload for a line you can't read that precisely anyway.
 */
export const getAccountBalanceSeries = cache(async (
  userId: string,
  months: number = 6,
) => {
  const balances = await getAccountBalances(userId);
  if (balances.length === 0) return [];

  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const from = toIsoDate(start);
  const today = toIsoDate(new Date());

  // No upper bound on purpose: currentBalance includes future-dated transactions,
  // so every delta from `from` onwards has to come back off to get the balance at
  // the window start.
  const rows = await db
    .select({
      accountId: transactions.accountId,
      date: transactions.date,
      delta: sql<number>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), gte(transactions.date, from)),
    )
    .groupBy(transactions.accountId, transactions.date);

  const byAccount = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.accountId) continue;
    const m = byAccount.get(r.accountId) ?? new Map<string, number>();
    m.set(r.date, Number(r.delta));
    byAccount.set(r.accountId, m);
  }

  return balances.map((a) => ({
    id: a.id,
    name: a.name,
    points: walkBalanceBack(
      a.currentBalance,
      byAccount.get(a.id) ?? new Map(),
      from,
      today,
    ),
  }));
});

/** Exported for tests. Rewinds `currentBalance` to `from`, then walks forward. */
export function walkBalanceBack(
  currentBalance: number,
  deltas: Map<string, number>,
  from: string,
  today: string,
): { date: string; value: number }[] {
  let running = currentBalance;
  for (const v of deltas.values()) running -= v;

  const points: { date: string; value: number }[] = [];
  const cursor = new Date(from + "T00:00:00");
  const stop = new Date(today + "T00:00:00");
  let day = 0;
  while (cursor <= stop) {
    const date = toIsoDate(cursor);
    running += deltas.get(date) ?? 0;
    if (day % 7 === 0 || date === today) points.push({ date, value: running });
    cursor.setDate(cursor.getDate() + 1);
    day++;
  }
  return points;
}

export async function getMonthSummary(
  userId: string,
  startDay: number = 1,
  scopeAccountIds?: string[],
) {
  const { monthStart, monthEnd } = getDateRanges(startDay);
  const accountIds = await getFundedAccountIds(userId, scopeAccountIds, monthStart, monthEnd);
  const accountFilter = accountIds && accountIds.length > 0
    ? inArray(transactions.accountId, accountIds)
    : sql`1=1`;

  const [accountBalances, monthIncome, monthExpense, monthPotSpend] =
    await Promise.all([
      getAccountBalances(userId),

      // Grouped rows are excluded here and netted into the pot spend below —
      // counting a pot's refund as income *and* as reduced pot spend would
      // credit it twice.
      db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "income"),
            sql`${transactions.groupId} IS NULL`,
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            accountFilter,
          )
        ),

      db
        .select({
          total: sql<number>`sum(${effectiveExpenseAmount()})`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            accountFilter,
          )
        ),

      // Netted per pot, like /api/insights and /api/budgets — a single net
      // across all pots would let one pot's deposit erase another's spending.
      db
        .select({ spent: sql<number>`${potSpentAmount()}` })
        .from(transactionGroups)
        .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
        .where(
          and(
            eq(transactionGroups.userId, userId),
            sql`${transactions.type} != 'internal_transfer'`,
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            accountFilter,
          )
        )
        .groupBy(transactionGroups.id),
    ]);

  const totalBalance = accountBalances.reduce(
    (acc, a) => acc + a.currentBalance,
    0
  );
  const potExpense = monthPotSpend.reduce(
    (s, r) => s + (Number(r.spent) || 0),
    0,
  );

  return {
    totalBalance,
    accountCount: accountBalances.length,
    monthIncome: Number(monthIncome[0]?.total) || 0,
    monthExpenses: (Number(monthExpense[0]?.total) || 0) + potExpense,
  };
}

interface SpikeRow {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  targetAmount: number;
  targetDate: string;
  fundedAmount: number;
  createdAt: string;
}

async function loadSpikeRowsBetween(
  userId: string,
  fromIso: string,
  toIso: string
): Promise<SpikeRow[]> {
  const rows = await db
    .select({
      id: transactionGroups.id,
      name: transactionGroups.name,
      categoryId: transactionGroups.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      targetAmount: transactionGroups.targetAmount,
      targetDate: transactionGroups.targetDate,
      fundedAmount: transactionGroups.fundedAmount,
      createdAt: transactionGroups.createdAt,
    })
    .from(transactionGroups)
    .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
    .where(
      and(
        eq(transactionGroups.userId, userId),
        isNotNull(transactionGroups.targetAmount),
        isNotNull(transactionGroups.targetDate),
        gte(transactionGroups.targetDate, fromIso),
        lte(transactionGroups.targetDate, toIso)
      )
    )
    .orderBy(transactionGroups.targetDate);

  return rows
    .filter(
      (r): r is typeof r & { targetAmount: number; targetDate: string } =>
        r.targetAmount != null && !!r.targetDate
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
      targetAmount: r.targetAmount,
      targetDate: r.targetDate,
      fundedAmount: r.fundedAmount ?? 0,
      createdAt: r.createdAt,
    }));
}

function baseSpikeFields(
  row: SpikeRow,
  today: Date,
  schedule: PaySchedule
): UpcomingSpike {
  const target = new Date(row.targetDate);
  target.setHours(0, 0, 0, 0);
  const daysUntil = Math.max(
    0,
    Math.round((target.getTime() - today.getTime()) / 86400000)
  );
  const paydays = paydaysBetween(schedule, today, target);
  const paydaysRemaining = Math.max(1, paydays.length);
  const remaining = Math.max(0, row.targetAmount - row.fundedAmount);
  const suggested = Math.max(0, remaining / paydaysRemaining);
  return {
    id: row.id,
    name: row.name,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    fundedAmount: row.fundedAmount,
    remaining,
    paydaysRemaining: paydays.length,
    suggestedAllocation: suggested,
    daysUntil,
  };
}

/**
 * Returns the dashboard's "free to spend this month" view, including each
 * upcoming this-month spike with a per-spike "fits / tight / over" badge and
 * an inline category warning when the spike would push its category's
 * allocation over budget.
 */
export async function getMonthMoneyView(
  userId: string,
  startDay: number = 1,
  scopeAccountIds?: string[],
): Promise<MonthMoneyView> {
  const { monthStart, monthEnd } = getDateRanges(startDay);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIsoDate(today);

  const accountIds = await getFundedAccountIds(userId, scopeAccountIds, monthStart, monthEnd);

  // Per-pot spend already booked this month. `math.freeToSpend` and
  // `alloc.spent` already include these amounts, so we subtract the spend
  // from each spike's targetAmount to avoid double-counting. Queried for every
  // target-pot (joined instead of filtered by the spike ids) so it can run in
  // the same wave as the spike rows — extra pots just go unread from the map.
  const [math, schedule, rows, inMonth] = await Promise.all([
    getMonthMoneyMath(userId, startDay, { accountIds }),
    getPaySchedule(userId),
    loadSpikeRowsBetween(userId, todayIso, monthEnd),
    db
      .select({
        groupId: transactions.groupId,
        spent: sql<number>`abs(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end))`,
      })
      .from(transactions)
      .innerJoin(
        transactionGroups,
        eq(transactions.groupId, transactionGroups.id),
      )
      .where(
        and(
          eq(transactions.userId, userId),
          isNotNull(transactionGroups.targetAmount),
          isNotNull(transactionGroups.targetDate),
          sql`${transactions.type} != 'internal_transfer'`,
          gte(transactions.date, monthStart),
          lte(transactions.date, monthEnd)
        )
      )
      .groupBy(transactions.groupId),
  ]);

  // Sort by date so the per-spike "free after" lines accumulate in time order.
  const sorted = rows
    .map((r) => ({ row: r, base: baseSpikeFields(r, today, schedule) }))
    .sort((a, b) => a.row.targetDate.localeCompare(b.row.targetDate));

  const spentByPot = new Map<string, number>();
  for (const r of inMonth) {
    if (r.groupId) spentByPot.set(r.groupId, Number(r.spent) || 0);
  }

  const remainingByPot = new Map<string, number>();
  for (const { row } of sorted) {
    remainingByPot.set(
      row.id,
      Math.max(0, row.targetAmount - (spentByPot.get(row.id) ?? 0))
    );
  }

  const upcomingThisMonthTotal = sorted.reduce(
    (s, { row }) => s + (remainingByPot.get(row.id) ?? 0),
    0
  );

  // Per-spike running deduction: each row's "freeAfter" is freeToSpend minus
  // the sum of this spike and every earlier-dated spike.
  let runningDeduction = 0;
  const thisMonthSpikes: ThisMonthSpike[] = sorted.map(({ row, base }) => {
    const remainingThisMonth = remainingByPot.get(row.id) ?? 0;
    runningDeduction += remainingThisMonth;
    const freeAfter = math.freeToSpend - runningDeduction;

    let status: SpikeImpactStatus = "fits";
    if (freeAfter < 0) status = "over";
    else if (math.freeToSpend > 0 && freeAfter < math.freeToSpend * 0.1)
      status = "tight";

    let categoryWarning: string | null = null;
    if (row.categoryId) {
      const alloc = math.allocations.get(row.categoryId);
      if (alloc) {
        const projected = alloc.spent + remainingThisMonth;
        if (projected > alloc.amount) {
          const overBy = projected - alloc.amount;
          categoryWarning = `Would push ${alloc.categoryName ?? "this category"} ${formatCurrency(overBy)} over budget`;
        }
      }
    }

    return { ...base, freeAfter, status, categoryWarning };
  });

  const freeToSpendAfterSpikes = math.freeToSpend - upcomingThisMonthTotal;

  return {
    monthlyIncome: math.monthlyIncome,
    totalFixedCosts: math.totalFixedCosts,
    spentThisMonth: math.spentThisMonth,
    freeToSpend: math.freeToSpend,
    freeToSpendAfterSpikes,
    upcomingThisMonthTotal,
    hasIncome: math.hasIncome,
    thisMonthSpikes,
  };
}

/**
 * Returns spikes whose target date falls *after* the current month, with
 * pay-cycle on-track math attached. This drives the "Saving toward" card.
 */
export async function getSavingTowardSpikes(
  userId: string,
  startDay: number = 1,
): Promise<SavingTowardSpike[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 365);

  const { monthEnd } = getDateRanges(startDay);
  const startIso = toIsoDate(
    new Date(new Date(monthEnd).getTime() + 86400000)
  );
  const endIso = toIsoDate(horizon);

  const [rows, schedule] = await Promise.all([
    loadSpikeRowsBetween(userId, startIso, endIso),
    getPaySchedule(userId),
  ]);

  if (rows.length === 0) return [];

  return rows.map((row) => {
    const base = baseSpikeFields(row, today, schedule);
    const created = new Date(row.createdAt);
    created.setHours(0, 0, 0, 0);
    const target = new Date(row.targetDate);
    target.setHours(0, 0, 0, 0);

    const totalPaydays = paydaysBetween(
      schedule,
      created < today ? created : today,
      target
    ).length;
    const elapsedPaydays = paydaysBetween(schedule, created, today).length;

    const { expectedFundedByNow, onTrack } = classifyOnTrack({
      fundedAmount: row.fundedAmount,
      targetAmount: row.targetAmount,
      totalPaydays,
      elapsedPaydays,
    });

    return {
      ...base,
      expectedFundedByNow,
      onTrack,
    };
  });
}

/**
 * Top spending categories across ALL accounts this period, each with a
 * per-budget split (via the transaction's account) so a shared category shows
 * which budget the money actually left.
 */
export async function getTopCategories(userId: string, startDay: number = 1) {
  const { monthStart, monthEnd } = getDateRanges(startDay);

  const [rows, plans] = await Promise.all([
    db
      .select({
        categoryId: categories.id,
        categoryName: categories.name,
        categoryColor: categories.color,
        budgetId: accounts.budgetId,
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          notInArray(
            sql`COALESCE(${categories.name}, '')`,
            defaultCategoryNames(TRANSFER_CATEGORY),
          ),
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, monthStart),
          lte(transactions.date, monthEnd),
        ),
      )
      .groupBy(transactions.categoryId, categories.id, accounts.budgetId),
    getUserPlans(userId),
  ]);

  const { t } = await getI18n();
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));
  const byCategory = new Map<
    string,
    {
      categoryId: string | null;
      name: string;
      color: string;
      total: number;
      byBudget: Map<string, number>;
    }
  >();
  for (const r of rows) {
    const key = r.categoryId ?? "";
    const entry = byCategory.get(key) ?? {
      categoryId: r.categoryId,
      name: r.categoryName || t("common.uncategorized"),
      color: r.categoryColor || "#94a3b8",
      total: 0,
      byBudget: new Map<string, number>(),
    };
    const amount = Number(r.total) || 0;
    entry.total += amount;
    const budgetLabel = (r.budgetId && planNameById.get(r.budgetId)) || t("dashboard.noBudget");
    entry.byBudget.set(budgetLabel, (entry.byBudget.get(budgetLabel) ?? 0) + amount);
    byCategory.set(key, entry);
  }

  return {
    planCount: plans.length,
    categories: Array.from(byCategory.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((c) => ({
        categoryId: c.categoryId,
        name: c.name,
        color: c.color,
        total: c.total,
        byBudget: Array.from(c.byBudget.entries())
          .map(([budgetName, total]) => ({ budgetName, total }))
          .sort((a, b) => b.total - a.total),
      })),
  };
}
