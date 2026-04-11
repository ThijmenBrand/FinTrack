import { cache } from "react";
import { db } from "@/db";
import { accounts, transactions, budgets, categories } from "@/db/schema";
import { eq, and, gte, lte, sql, sum, inArray } from "drizzle-orm";

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

export async function getTopCategories(userId: string) {
  const { monthStart, monthEnd } = getDateRanges();

  const topCats = await db
    .select({
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
    .groupBy(transactions.categoryId)
    .orderBy(sql`sum(abs(${transactions.amount})) DESC`)
    .limit(5);

  return topCats.map((c) => ({
    name: c.categoryName || "Uncategorized",
    color: c.categoryColor || "#94a3b8",
    total: c.total,
  }));
}
