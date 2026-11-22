import { getI18n } from "@/lib/i18n/server";
import { cache } from "react";
import {
  getDateRanges,
  getFundedAccountIds,
  getMainPlan,
  getScopeAccountRows,
  fixedCostBudgetLines,
  loadBudgetOverview,
  type BudgetOverview,
} from "@/lib/budget-overview";
import { getAccountBalances } from "@/lib/account-balances";
import {
  isCashAccount,
  isInvestmentAccount,
  isValuationStale,
  sumCashBalances,
} from "@/lib/account-kinds";
import { getUpcomingMoney } from "@/lib/upcoming-money";
import { db } from "@/db";
import {
  accounts,
  budgetPlans,
  transactions,
  categories,
  transactionGroups,
  accountMembers,
  user,
} from "@/db/schema";
import { eq, and, or, asc, gte, lte, sql, sum, inArray, isNotNull, isNull } from "drizzle-orm";
import { activeMembership, visibleTransactions } from "@/lib/account-access";
import { getPaySchedule, paydaysBetween, type PaySchedule } from "@/lib/pay-schedule";
import {
  getMonthMoneyMath,
  monthIncomeTotal,
  monthPotSpendTotal,
} from "@/lib/month-money";
import { classifyOnTrack } from "@/lib/on-track";
import { accountScopeFilter } from "@/lib/budget-plan";
import { formatCurrency, toIsoDate } from "@/lib/utils";
import { effectiveExpenseAmount } from "@/lib/reimbursement-sql";
import { excludeSplitChildren, excludeSplitParents } from "@/lib/split-sql";
import { loadPotBudgetViews } from "@/lib/pot-budget-db";
import type {
  DashboardPotBudget,
  MonthMoneyView,
  SavingTowardSpike,
  SpikeImpactStatus,
  ThisMonthSpike,
  UpcomingSpike,
} from "@/types/api";


/**
 * All plans the user can read, own plans first (oldest first), then plans
 * reached through shared accounts (labeled with ownerName) — drives the budget
 * card's switcher.
 */
export const getUserPlans = cache(async (userId: string) => {
  const [own, shared] = await db.batch([
    db
      .select({
        id: budgetPlans.id,
        name: budgetPlans.name,
        isMain: budgetPlans.isMain,
      })
      .from(budgetPlans)
      .where(eq(budgetPlans.userId, userId))
      .orderBy(asc(budgetPlans.createdAt)),
    db
      .selectDistinct({
        id: budgetPlans.id,
        name: budgetPlans.name,
        ownerName: user.name,
      })
      .from(accountMembers)
      .innerJoin(accounts, eq(accounts.id, accountMembers.accountId))
      .innerJoin(budgetPlans, eq(budgetPlans.id, accounts.budgetId))
      .innerJoin(user, eq(user.id, budgetPlans.userId))
      .where(activeMembership(userId)),
  ]);
  return [
    ...own.map((p) => ({ ...p, ownerName: null as string | null })),
    ...shared.map((p) => ({ ...p, isMain: false })),
  ];
});


export { getMainPlan, getScopeAccountRows, fixedCostBudgetLines, getAccountBalances, getUpcomingMoney };
export type { BudgetOverview };

/** The budget card for one plan (default: the main plan), in the request's language. */
export const getBudgetOverview = cache(async (
  userId: string,
  startDay: number = 1,
  planId?: string,
): Promise<BudgetOverview> => {
  const { t } = await getI18n();
  return loadBudgetOverview(userId, startDay, planId, t("dashboard.intoPots"));
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
  // Cash only: this walks a balance backwards through transactions, and an
  // investment account has none. Its line would be flat at today's valuation
  // all the way back through months it wasn't worth that — a drawn claim the
  // data cannot support.
  const balances = (await getAccountBalances(userId)).filter(isCashAccount);
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
      and(
        visibleTransactions(userId),
        excludeSplitChildren(),
        gte(transactions.date, from),
      ),
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

/**
 * The investments block: what the valuation accounts are worth, next to what
 * the ledger says was actually put into them.
 *
 * The two numbers come from different places on purpose. Value is typed in by
 * hand and is only as true as its date. Contributions are the ledger's own
 * answer — the `internal_transfer` legs that landed in these accounts — so
 * they are exact, and they are the figure the gap between the two is measured
 * against. Returns null when the user has no investment accounts: a card
 * advertising a feature nobody opted into is the widget soup this app avoids.
 */
export const getInvestmentSummary = cache(async (userId: string) => {
  const investments = (await getAccountBalances(userId)).filter(isInvestmentAccount);
  if (investments.length === 0) return null;

  const ids = investments.map((a) => a.id);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  // Inflows only. A transfer out of a broker is a withdrawal, and netting it
  // against deposits is right: "invested" means what is currently in there,
  // not gross money ever sent.
  const [lifetimeRows, yearRows] = await Promise.all([
    db
      .select({ accountId: transactions.accountId, total: sum(transactions.amount) })
      .from(transactions)
      .where(
        and(
          visibleTransactions(userId),
          inArray(transactions.accountId, ids),
          eq(transactions.type, "internal_transfer"),
          excludeSplitChildren(),
        ),
      )
      .groupBy(transactions.accountId),
    db
      .select({ total: sum(transactions.amount) })
      .from(transactions)
      .where(
        and(
          visibleTransactions(userId),
          inArray(transactions.accountId, ids),
          eq(transactions.type, "internal_transfer"),
          excludeSplitChildren(),
          gte(transactions.date, yearStart),
        ),
      ),
  ]);
  const contributedBy = new Map(
    lifetimeRows.map((r) => [r.accountId, Number(r.total) || 0]),
  );

  const rows = investments.map((a) => ({
    id: a.id,
    // The ACCOUNT OWNER, which is not the reader on a shared account. Trades,
    // prices and valuations all live in the owner's space.
    ownerId: a.userId,
    name: a.name,
    bank: a.bank,
    bankName: a.bankName,
    currentValue: a.currentValue,
    valuedAt: a.valuedAt,
    contributed: contributedBy.get(a.id) ?? 0,
  }));

  const totalValue = rows.reduce((t, r) => t + (r.currentValue ?? 0), 0);
  const totalContributed = rows.reduce((t, r) => t + r.contributed, 0);

  // The total is only as current as its stalest part, so the headline wears
  // the OLDEST date, not the newest. Picking the newest would let one updated
  // account vouch for three that nobody has touched since spring.
  const dates = rows.map((r) => r.valuedAt).filter((d): d is string => !!d);
  const valuedAt = dates.length === rows.length && dates.length > 0
    ? dates.reduce((oldest, d) => (d < oldest ? d : oldest))
    : null;

  return {
    accounts: rows,
    totalValue,
    totalContributed,
    investedThisYear: Number(yearRows[0]?.total) || 0,
    // Any unvalued or overdue account makes the whole figure suspect.
    stale: rows.some((r) => isValuationStale(r.valuedAt)),
    valuedAt,
  };
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

  // Income and pot spend come from the shared readers in month-money, which
  // Free to Spend asks for the same window and scope — on the dashboard the
  // second card to ask pays nothing.
  const [accountBalances, monthIncome, monthExpense, potExpense] =
    await Promise.all([
      getAccountBalances(userId),

      monthIncomeTotal(userId, monthStart, monthEnd, accountIds),

      db
        .select({
          total: sql<number>`sum(${effectiveExpenseAmount()})`,
        })
        .from(transactions)
        .where(
          and(
            visibleTransactions(userId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            excludeSplitParents(),
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            accountFilter,
          )
        ),

      monthPotSpendTotal(userId, monthStart, monthEnd, accountIds),
    ]);

  // Cash only. "Total balance" sits beside income and expenses as money you
  // hold and could spend; folding a portfolio valuation into it would make
  // the figure move with the market between two transactions.
  const totalBalance = sumCashBalances(accountBalances);

  return {
    totalBalance,
    accountCount: accountBalances.filter(isCashAccount).length,
    monthIncome,
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
          excludeSplitParents(),
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
 * Pots being spent against a budget: a total and either no date, or a date
 * that has arrived (before it, the pot is in Saving toward instead) within the
 * last month — the same cutoff after which the Pots page files a dated pot
 * under "past". Archived pots are done. Over-budget pots first, then the
 * closest to it.
 */
/** The same calendar day a month earlier (YYYY-MM-DD). */
function monthBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() - 1);
  return toIsoDate(d);
}

export async function getPotBudgets(
  userId: string,
  todayIso: string = toIsoDate(new Date()),
): Promise<DashboardPotBudget[]> {
  const rows = await db
    .select({
      id: transactionGroups.id,
      name: transactionGroups.name,
      categoryColor: categories.color,
      targetAmount: transactionGroups.targetAmount,
      targetDate: transactionGroups.targetDate,
    })
    .from(transactionGroups)
    .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
    .where(
      and(
        eq(transactionGroups.userId, userId),
        isNull(transactionGroups.archivedAt),
        isNotNull(transactionGroups.targetAmount),
        or(
          isNull(transactionGroups.targetDate),
          and(lte(transactionGroups.targetDate, todayIso), gte(transactionGroups.targetDate, monthBefore(todayIso))),
        ),
      ),
    );
  if (rows.length === 0) return [];

  const views = await loadPotBudgetViews(db, userId, rows);
  const rank = { exceeded: 0, warning: 1, ok: 2 } as const;
  return rows
    .map((r) => {
      const v = views.get(r.id)!;
      return {
        id: r.id,
        name: r.name,
        categoryColor: r.categoryColor,
        total: r.targetAmount!,
        spent: v.spent,
        pct: v.pct,
        status: v.status,
        targetDate: r.targetDate,
        worstLine: v.worstLine,
      };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || b.pct - a.pct);
}

/**
 * Top spending categories across ALL accounts this period, each with a
 * per-budget split (via the transaction's account) so a shared category shows
 * which budget the money actually left.
 */
/**
 * Top spending categories this period. `accountIds` narrows it to one budget's
 * accounts — under a budget scope the card must not rank spending from budgets
 * that aren't on screen. Undefined keeps it cross-budget, with the per-budget
 * split line that makes it readable.
 */
export async function getTopCategories(
  userId: string,
  startDay: number = 1,
  accountIds?: string[],
) {
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
          visibleTransactions(userId),
          eq(transactions.type, "expense"),
          // By stored kind, not by name: a renamed transfer bucket must still
          // stay out of "top spending categories". COALESCE keeps rows with no
          // category at all (kind IS NULL on the left join) in the result.
          sql`COALESCE(${categories.kind}, 'expense') != 'transfer'`,
          sql`${transactions.groupId} IS NULL`,
          excludeSplitParents(),
          gte(transactions.date, monthStart),
          lte(transactions.date, monthEnd),
          accountScopeFilter(accountIds),
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
    // Scoped to one budget: every row is that budget's, so the split line
    // would repeat its name five times.
    planCount: accountIds ? 1 : plans.length,
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
