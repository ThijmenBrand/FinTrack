import { cache } from "react";
import { db } from "@/db";
import {
  accounts,
  transactions,
  budgets,
  categories,
  recurringTransactions,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, sql, sum, inArray, isNotNull } from "drizzle-orm";
import { getPaySchedule, paydaysBetween, type PaySchedule } from "@/lib/pay-schedule";
import { getMonthMoneyMath, toMonthly } from "@/lib/month-money";
import { classifyOnTrack } from "@/lib/on-track";
import { getFinancialMonthRange } from "@/lib/financial-month";
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

function reimbursementAdjustment() {
  return sql`COALESCE(
    (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
    0
  )`;
}

function getDateRanges(startDay: number = 1) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  const { from: monthStart, to: monthEnd } = getFinancialMonthRange(now, startDay);

  const weekOff = dow === 0 ? -6 : 1 - dow;
  const weekStart = toIsoDate(new Date(y, m, d + weekOff));
  const weekEnd = toIsoDate(new Date(y, m, d + weekOff + 6));

  const lastWeekStart = toIsoDate(new Date(y, m, d + weekOff - 7));
  const lastWeekEnd = toIsoDate(new Date(y, m, d + weekOff - 1));

  // Fraction of the financial-month elapsed, including today.
  // Parse as local midnight so the math matches the local `todayMs` below.
  const startMs = new Date(`${monthStart}T00:00:00`).getTime();
  const endMs = new Date(`${monthEnd}T00:00:00`).getTime();
  const totalDays = Math.round((endMs - startMs) / 86400000) + 1;
  const todayMs = new Date(y, m, d).getTime();
  const elapsedDays = Math.min(
    totalDays,
    Math.max(1, Math.round((todayMs - startMs) / 86400000) + 1),
  );
  const monthProgress = totalDays > 0 ? elapsedDays / totalDays : 0;

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
 * Resolve a single `defaultAccountId` to the set of accounts whose activity
 * should count toward "your" spending: the default account itself, plus any
 * account that received an `internal_transfer` paired with an outflow on the
 * default account during the period.
 *
 * This handles the cross-account spending case: when the user transfers €X
 * from their main account to a secondary account and then spends from the
 * secondary, that spending was funded from the default account and should
 * still appear in the account-scoped Expenses / Free to Spend tiles.
 *
 * Returns `undefined` (meaning "no scoping") when `defaultAccountId` is null.
 */
async function getFundedAccountIds(
  userId: string,
  defaultAccountId: string | undefined,
  from: string,
  to: string,
): Promise<string[] | undefined> {
  if (!defaultAccountId) return undefined;
  const rows = await db
    .select({ destAccountId: transactions.accountId })
    .from(transactions)
    .innerJoin(
      sql`transactions src`,
      sql`src.id = ${transactions.linkedTransactionId}
          AND src.user_id = ${userId}
          AND src.account_id = ${defaultAccountId}
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
  const set = new Set<string>([defaultAccountId]);
  for (const r of rows) if (r.destAccountId) set.add(r.destAccountId);
  return Array.from(set);
}

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
): Promise<CategorySpend[]> {
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
      ),
    )
    .groupBy(transactionGroups.id, transactionGroups.categoryId);

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
      categoryName: r.categoryId ? r.categoryName : "Into pots",
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

export const getBudgetOverview = cache(async (
  userId: string,
  startDay: number = 1,
) => {
  // Budgets are envelope-style and span all of a user's spending, so they
  // intentionally ignore the dashboard's defaultAccountId scoping.
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
          ),
        ),

      db
        .select({
          amount: recurringTransactions.amount,
          frequency: recurringTransactions.frequency,
        })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.type, "expense"),
            eq(recurringTransactions.isActive, true),
            eq(recurringTransactions.userId, userId),
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
          ),
        )
        .groupBy(transactions.categoryId),

      getPotSpendByCategory(userId, monthStart, monthEnd),
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
              )
            )
            .groupBy(transactions.categoryId),
          getPotSpendByCategory(userId, from, to),
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

  const budgetItems = allBudgets
    .map((b) => {
      const spent = spendingByCategory.get(b.categoryId) || 0;
      const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
      return {
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        categoryColor: b.categoryColor,
        categoryIcon: b.categoryIcon,
        period: b.period,
        spent,
        limit: b.amount,
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
  const totalAllocated = allBudgets.reduce((s, b) => s + b.amount, 0);
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
  const budgetedCategoryIds = new Set(allBudgets.map((b) => b.categoryId));
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
    budgetItems,
    unbudgetedItems,
    unbudgetedTotal: unbudgetedItems.reduce((s, r) => s + r.spent, 0),
    totalBudgeted,
    totalBudgetSpent,
    monthProgress,
  };
});

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
  accountId?: string,
) {
  const { monthStart, monthEnd } = getDateRanges(startDay);
  const accountIds = await getFundedAccountIds(userId, accountId, monthStart, monthEnd);
  const accountFilter = accountIds && accountIds.length > 0
    ? inArray(transactions.accountId, accountIds)
    : sql`1=1`;
  const accountFilterAlias = accountIds && accountIds.length > 0
    ? sql` AND t.account_id IN (${sql.join(
        accountIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;

  const [accountBalances, monthIncome, monthExpense, monthPotContrib] =
    await Promise.all([
      getAccountBalances(userId),

      db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "income"),
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            accountFilter,
          )
        ),

      db
        .select({
          total: sql<number>`sum(${transactions.amount} + ${reimbursementAdjustment()})`,
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
            accountFilter,
          )
        ),

      db
        .select({
          potNet: sql<number>`SUM(t.amount)`,
        })
        .from(sql`transactions t`)
        .innerJoin(sql`transaction_groups g`, sql`t.group_id = g.id`)
        .where(
          sql`t.group_id IS NOT NULL AND t.type != 'internal_transfer' AND t.user_id = ${userId} AND t.date >= ${monthStart} AND t.date <= ${monthEnd}${accountFilterAlias}`
        ),
    ]);

  const totalBalance = accountBalances.reduce(
    (acc, a) => acc + a.currentBalance,
    0
  );
  const monthPotExpense = Math.min(0, monthPotContrib[0]?.potNet || 0);

  return {
    totalBalance,
    accountCount: accountBalances.length,
    monthIncome: Number(monthIncome[0]?.total) || 0,
    monthExpenses:
      Math.abs(Number(monthExpense[0]?.total) || 0) +
      Math.abs(monthPotExpense),
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
  accountId?: string,
): Promise<MonthMoneyView> {
  const { monthStart, monthEnd } = getDateRanges(startDay);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIsoDate(today);

  const accountIds = await getFundedAccountIds(userId, accountId, monthStart, monthEnd);

  const [math, schedule, rows] = await Promise.all([
    getMonthMoneyMath(userId, startDay, { accountIds }),
    getPaySchedule(userId),
    loadSpikeRowsBetween(userId, todayIso, monthEnd),
  ]);

  // Sort by date so the per-spike "free after" lines accumulate in time order.
  const sorted = rows
    .map((r) => ({ row: r, base: baseSpikeFields(r, today, schedule) }))
    .sort((a, b) => a.row.targetDate.localeCompare(b.row.targetDate));

  // Per-pot spend already booked this month. `math.freeToSpend` and
  // `alloc.spent` already include these amounts, so we subtract the spend
  // from each spike's targetAmount to avoid double-counting.
  const potIds = sorted.map(({ row }) => row.id);
  const spentByPot = new Map<string, number>();
  if (potIds.length > 0) {
    const inMonth = await db
      .select({
        groupId: transactions.groupId,
        spent: sql<number>`abs(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end))`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.groupId, potIds),
          sql`${transactions.type} != 'internal_transfer'`,
          gte(transactions.date, monthStart),
          lte(transactions.date, monthEnd)
        )
      )
      .groupBy(transactions.groupId);
    for (const r of inMonth) {
      if (r.groupId) spentByPot.set(r.groupId, Number(r.spent) || 0);
    }
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

export async function getTopCategories(
  userId: string,
  startDay: number = 1,
  accountId?: string,
) {
  const { monthStart, monthEnd } = getDateRanges(startDay);
  const accountIds = await getFundedAccountIds(userId, accountId, monthStart, monthEnd);
  const accountFilter = accountIds && accountIds.length > 0
    ? inArray(transactions.accountId, accountIds)
    : sql`1=1`;

  const topCats = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryColor: categories.color,
      total: sql<number>`sum(${effectiveExpenseAmount()})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        sql`COALESCE(${categories.name}, '') <> 'Internal Transfer'`,
        sql`${transactions.groupId} IS NULL`,
        gte(transactions.date, monthStart),
        lte(transactions.date, monthEnd),
        accountFilter,
      )
    )
    .groupBy(transactions.categoryId, categories.id)
    .orderBy(sql`sum(abs(${transactions.amount})) DESC`)
    .limit(5);

  return topCats.map((c) => ({
    categoryId: c.categoryId,
    name: c.categoryName || "Uncategorized",
    color: c.categoryColor || "#94a3b8",
    total: c.total,
  }));
}
