import { cache } from "react";
import { db } from "@/db";
import {
  accounts,
  transactions,
  budgets,
  categories,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, sql, sum, inArray, isNotNull } from "drizzle-orm";
import { getPaySchedule, paydaysBetween, type PaySchedule } from "@/lib/pay-schedule";
import { getMonthMoneyMath } from "@/lib/month-money";
import { classifyOnTrack } from "@/lib/on-track";
import type {
  MonthMoneyView,
  SavingTowardSpike,
  SpikeImpactStatus,
  ThisMonthSpike,
  UpcomingSpike,
} from "@/types/api";

// ─── Helpers ────────────────────────────────────────────────────────

export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getPeriodRange(period: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  switch (period) {
    case "daily": {
      const iso = toLocalDateStr(new Date(y, m, d));
      return { from: iso, to: iso };
    }
    case "weekly": {
      const off = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(y, m, d + off);
      const sun = new Date(mon);
      sun.setDate(sun.getDate() + 6);
      return { from: toLocalDateStr(mon), to: toLocalDateStr(sun) };
    }
    case "monthly": {
      return {
        from: toLocalDateStr(new Date(y, m, 1)),
        to: toLocalDateStr(new Date(y, m + 1, 0)),
      };
    }
    case "yearly":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default:
      return { from: "2000-01-01", to: "2099-12-31" };
  }
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function reimbursementAdjustment() {
  return sql`COALESCE(
    (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
    0
  )`;
}

function getDateRanges() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  const monthStart = toLocalDateStr(new Date(y, m, 1));
  const monthEnd = toLocalDateStr(new Date(y, m + 1, 0));

  const weekOff = dow === 0 ? -6 : 1 - dow;
  const weekStart = toLocalDateStr(new Date(y, m, d + weekOff));
  const weekEnd = toLocalDateStr(new Date(y, m, d + weekOff + 6));

  const lastWeekStart = toLocalDateStr(new Date(y, m, d + weekOff - 7));
  const lastWeekEnd = toLocalDateStr(new Date(y, m, d + weekOff - 1));

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthProgress = d / daysInMonth;

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

// ─── Per-widget queries ─────────────────────────────────────────────

export async function getWeeklySpending(userId: string) {
  const { weekStart, weekEnd, lastWeekStart, lastWeekEnd } = getDateRanges();

  const [weekExpense, lastWeekExpense, weekPotContrib] = await Promise.all([
    db
      .select({
        total: sql<number>`sum(abs(${transactions.amount}) - ${reimbursementAdjustment()})`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`COALESCE(${categories.name}, '') <> 'Internal Transfer'`,
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, weekStart),
          lte(transactions.date, weekEnd)
        )
      ),

    db
      .select({
        total: sql<number>`sum(abs(${transactions.amount}) - ${reimbursementAdjustment()})`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`COALESCE(${categories.name}, '') <> 'Internal Transfer'`,
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, lastWeekStart),
          lte(transactions.date, lastWeekEnd)
        )
      ),

    db
      .select({
        potNet: sql<number>`SUM(t.amount)`,
      })
      .from(sql`transactions t`)
      .innerJoin(sql`transaction_groups g`, sql`t.group_id = g.id`)
      .where(
        sql`t.group_id IS NOT NULL AND t.user_id = ${userId} AND t.date >= ${weekStart} AND t.date <= ${weekEnd}`
      ),
  ]);

  const weekPotExpense = Math.abs(
    Math.min(0, weekPotContrib[0]?.potNet || 0)
  );

  return {
    weekExpenses: (weekExpense[0]?.total || 0) + weekPotExpense,
    lastWeekExpenses: lastWeekExpense[0]?.total || 0,
    weekStart,
    weekEnd,
  };
}

export async function getBudgetOverview(userId: string) {
  const { monthStart, monthEnd, monthProgress } = getDateRanges();

  const allBudgets = await db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      amount: budgets.amount,
      period: budgets.period,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id))
    .where(and(eq(budgets.isActive, true), eq(budgets.userId, userId)));

  // Round 2: budget spending batched by period
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
        const { from, to } = getPeriodRange(period);
        const categoryIds = periodBudgets.map((b) => b.categoryId);
        const results = await db
          .select({
            categoryId: transactions.categoryId,
            total: sql<number>`sum(abs(${transactions.amount}) - ${reimbursementAdjustment()})`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              inArray(transactions.categoryId, categoryIds),
              eq(transactions.type, "expense"),
              sql`${transactions.groupId} IS NULL`,
              gte(transactions.date, from),
              lte(transactions.date, to)
            )
          )
          .groupBy(transactions.categoryId);
        for (const r of results) {
          if (r.categoryId) {
            spendingByCategory.set(r.categoryId, r.total || 0);
          }
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

  const totalBudgeted = allBudgets.reduce((s, b) => s + b.amount, 0);
  const totalBudgetSpent = budgetItems.reduce((s, b) => s + b.spent, 0);

  return {
    budgetItems,
    totalBudgeted,
    totalBudgetSpent,
    monthProgress,
  };
}

export const getAccountBalances = cache(async (userId: string) => {
  const accountBalanceRows = await db
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: accounts.name,
      type: accounts.type,
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

export async function getMonthSummary(userId: string) {
  const { monthStart, monthEnd } = getDateRanges();

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
            lte(transactions.date, monthEnd)
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
            sql`COALESCE(${categories.name}, '') <> 'Internal Transfer'`,
            sql`${transactions.groupId} IS NULL`,
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd)
          )
        ),

      db
        .select({
          potNet: sql<number>`SUM(t.amount)`,
        })
        .from(sql`transactions t`)
        .innerJoin(sql`transaction_groups g`, sql`t.group_id = g.id`)
        .where(
          sql`t.group_id IS NOT NULL AND t.user_id = ${userId} AND t.date >= ${monthStart} AND t.date <= ${monthEnd}`
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
export async function getMonthMoneyView(userId: string): Promise<MonthMoneyView> {
  const { monthStart, monthEnd } = getDateRanges();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toLocalDateStr(today);

  const [math, schedule, rows] = await Promise.all([
    getMonthMoneyMath(userId),
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
  userId: string
): Promise<SavingTowardSpike[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 365);

  const { monthEnd } = getDateRanges();
  const startIso = toLocalDateStr(
    new Date(new Date(monthEnd).getTime() + 86400000)
  );
  const endIso = toLocalDateStr(horizon);

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
 * Backwards-compatible export: returns all upcoming-targeted pots within 90
 * days. Phase-2 callers should prefer `getMonthMoneyView` /
 * `getSavingTowardSpikes`.
 */
export async function getUpcomingSpikes(userId: string): Promise<UpcomingSpike[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toLocalDateStr(today);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 90);
  const horizonIso = toLocalDateStr(horizon);

  const [rows, schedule] = await Promise.all([
    loadSpikeRowsBetween(userId, todayIso, horizonIso),
    getPaySchedule(userId),
  ]);

  return rows.map((row) => baseSpikeFields(row, today, schedule));
}

export async function getTopCategories(userId: string) {
  const { monthStart, monthEnd } = getDateRanges();

  const topCats = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryColor: categories.color,
      total: sql<number>`sum(abs(${transactions.amount}) - ${reimbursementAdjustment()})`,
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
        lte(transactions.date, monthEnd)
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
