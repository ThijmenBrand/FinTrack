export const dynamic = "force-dynamic";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { accounts, transactions, budgets, categories } from "@/db/schema";
import { eq, and, gte, lte, sql, sum, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import {
  Landmark,
  TrendingUp,
  TrendingDown,
  ArrowDown,
  ArrowUp,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPeriodRange(period: string): { from: string; to: string } {
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

function reimbursementAdjustment() {
  return sql`COALESCE(
    (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
    0
  )`;
}

async function getDashboardData(userId: string) {
  try {
    // Date ranges
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

    // Round 1: all independent queries in parallel
    const [
      accountBalanceRows,
      weekExpense,
      lastWeekExpense,
      monthIncome,
      monthExpense,
      allBudgets,
      topCats,
      weekPotContrib,
      monthPotContrib,
    ] = await Promise.all([
      // Account balances — single query with LEFT JOIN instead of N+1
      db
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
        .groupBy(accounts.id),

      // Week expenses
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

      // Last week expenses
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

      // Month income
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

      // Month expenses
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

      // Active budgets
      db
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
        .where(and(eq(budgets.isActive, true), eq(budgets.userId, userId))),

      // Top 5 spending categories this month
      db
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
        .limit(5),

      // Week pot contributions
      db
        .select({
          potNet: sql<number>`SUM(t.amount)`,
        })
        .from(sql`transactions t`)
        .innerJoin(sql`transaction_groups g`, sql`t.group_id = g.id`)
        .where(
          sql`t.group_id IS NOT NULL AND t.user_id = ${userId} AND t.date >= ${weekStart} AND t.date <= ${weekEnd}`
        ),

      // Month pot contributions
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

    // Process account balances
    const accountBalances = accountBalanceRows.map((row) => ({
      ...row,
      currentBalance: row.initialBalance + Number(row.txTotal),
    }));
    const totalBalance = accountBalances.reduce(
      (acc, a) => acc + a.currentBalance,
      0
    );

    // Round 2: budget spending — batched by period instead of N+1
    const budgetsByPeriod = new Map<string, typeof allBudgets>();
    for (const b of allBudgets) {
      const existing = budgetsByPeriod.get(b.period) || [];
      existing.push(b);
      budgetsByPeriod.set(b.period, existing);
    }

    const spendingByCategory = new Map<string, number>();
    await Promise.all(
      Array.from(budgetsByPeriod.entries()).map(async ([period, periodBudgets]) => {
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
      })
    );

    const budgetItems = allBudgets.map((b) => {
      const spent = spendingByCategory.get(b.categoryId) || 0;
      const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
      return {
        categoryName: b.categoryName,
        categoryColor: b.categoryColor,
        spent,
        limit: b.amount,
        percentage: Math.round(pct),
        status: pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok" as "ok" | "warning" | "exceeded",
      };
    });

    const totalBudgeted = allBudgets.reduce((s, b) => s + b.amount, 0);
    const totalBudgetSpent = budgetItems.reduce((s, b) => s + b.spent, 0);

    const weekPotExpense = Math.abs(Math.min(0, weekPotContrib[0]?.potNet || 0));
    const monthPotExpense = Math.min(0, monthPotContrib[0]?.potNet || 0);

    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthProgress = d / daysInMonth;

    return {
      accounts: accountBalances,
      totalBalance,
      monthIncome: Number(monthIncome[0]?.total) || 0,
      monthExpenses: Math.abs(Number(monthExpense[0]?.total) || 0) + Math.abs(monthPotExpense),
      weekExpenses: (weekExpense[0]?.total || 0) + weekPotExpense,
      lastWeekExpenses: lastWeekExpense[0]?.total || 0,
      weekStart,
      weekEnd,
      budgetItems: budgetItems.sort((a, b) => b.percentage - a.percentage),
      totalBudgeted,
      totalBudgetSpent,
      monthProgress,
      topCategories: topCats.map((c) => ({
        name: c.categoryName || "Uncategorized",
        color: c.categoryColor || "#94a3b8",
        total: c.total,
      })),
    };
  } catch (e) {
    console.error("Dashboard data fetch failed:", e);
    return {
      accounts: [],
      totalBalance: 0,
      monthIncome: 0,
      monthExpenses: 0,
      weekExpenses: 0,
      lastWeekExpenses: 0,
      weekStart: "",
      weekEnd: "",
      budgetItems: [],
      totalBudgeted: 0,
      totalBudgetSpent: 0,
      monthProgress: 0,
      topCategories: [],
    };
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

/**
 * SVG circular progress ring component
 */
function RingProgress({
  percentage,
  size,
  strokeWidth,
  color,
  trackColor = "var(--ring-progress-track, #e5e7eb)",
  ariaLabel,
}: {
  percentage: number;
  size: number;
  strokeWidth: number;
  color: string;
  trackColor?: string;
  ariaLabel?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(percentage, 100) / 100) * circ;
  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 -rotate-90"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const data = await getDashboardData(session.userId);
  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Week comparison
  const weekDiff =
    data.lastWeekExpenses > 0
      ? ((data.weekExpenses - data.lastWeekExpenses) / data.lastWeekExpenses) * 100
      : 0;
  const weekUp = weekDiff > 0;

  const wStart = new Date(data.weekStart + "T12:00:00");
  const wEnd = new Date(data.weekEnd + "T12:00:00");
  const weekLabel = `${wStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${wEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  // Overall budget health
  const budgetLeft = Math.max(0, data.totalBudgeted - data.totalBudgetSpent);
  const overallBudgetPct =
    data.totalBudgeted > 0
      ? Math.round((data.totalBudgetSpent / data.totalBudgeted) * 100)
      : 0;
  const overallRingColor =
    overallBudgetPct >= 100
      ? "var(--color-destructive)"
      : overallBudgetPct >= 80
        ? "var(--color-warning)"
        : "var(--color-primary)";

  return (
    <div className="space-y-6">
      {/* ── Hero: Weekly spending ────────────────────────────────── */}
      <div className="rounded-2xl border-2 border-border bg-card p-6 sm:p-8 relative overflow-hidden">
        {/* subtle gradient accent */}
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Spent this week
            </p>
            <div className="text-5xl sm:text-6xl font-black tracking-tight text-foreground">
              {formatCurrency(data.weekExpenses)}
            </div>
            <p className="text-sm text-muted-foreground mt-2">{weekLabel}</p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2">
            {data.lastWeekExpenses > 0 && (
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                  weekUp
                    ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                }`}
              >
                {weekUp ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                )}
                {Math.abs(Math.round(weekDiff))}% vs last week
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Last week: {formatCurrency(data.lastWeekExpenses)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Budget overview card ─────────────────────────────────── */}
      {data.budgetItems.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Top: ring + summary */}
            <div className="flex items-center gap-5 p-6 pb-4">
              <div className="relative">
                <RingProgress
                  percentage={overallBudgetPct}
                  size={72}
                  strokeWidth={8}
                  color={overallRingColor}
                  trackColor="hsl(var(--muted))"
                  ariaLabel={`Budget: ${overallBudgetPct} percent used`}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-base font-bold leading-none tabular-nums">
                    {overallBudgetPct}%
                  </span>
                  <span className="text-xs text-muted-foreground">used</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {monthLabel} Budget
                  </p>
                  <Link
                    href="/budgets"
                    className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded flex items-center gap-0.5"
                  >
                    All Budgets <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </div>
                <p className="text-3xl font-bold tracking-tight tabular-nums">
                  {formatCurrency(budgetLeft)}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    left to spend
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatCurrency(data.totalBudgetSpent)} spent of{" "}
                  {formatCurrency(data.totalBudgeted)} this month
                </p>
              </div>
            </div>

            {/* Dual progress bars: budget vs month elapsed */}
            <div className="px-6 pb-4 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-14 shrink-0">Spent</span>
                <div
                  className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={overallBudgetPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Budget: ${overallBudgetPct}% spent`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(overallBudgetPct, 100)}%`,
                      backgroundColor: overallRingColor,
                    }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums w-10 text-right">
                  {overallBudgetPct}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-14 shrink-0">Month</span>
                <div
                  className="flex-1 h-2 bg-muted rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(data.monthProgress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Month: ${Math.round(data.monthProgress * 100)}% elapsed`}
                >
                  <div
                    className="h-full rounded-full bg-muted-foreground/30 transition-all duration-500"
                    style={{ width: `${Math.round(data.monthProgress * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums w-10 text-right">
                  {Math.round(data.monthProgress * 100)}%
                </span>
              </div>
            </div>

            {/* Category chips — horizontal scroll with fade */}
            <div className="relative border-t">
              <div className="px-6 py-4 flex gap-3 overflow-x-auto scrollbar-hide">
                {data.budgetItems.map((item, i) => {
                  const pct = Math.min(item.percentage, 100);
                  const ringColor =
                    item.status === "exceeded"
                      ? "var(--color-destructive)"
                      : item.status === "warning"
                        ? "var(--color-warning)"
                        : item.categoryColor || "var(--color-primary)";
                  const left = Math.max(0, item.limit - item.spent);

                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 shrink-0 min-w-[170px]"
                    >
                      <div className="relative">
                        <RingProgress
                          percentage={pct}
                          size={40}
                          strokeWidth={4}
                          color={ringColor}
                          trackColor="hsl(var(--muted))"
                          ariaLabel={`${item.categoryName}: ${pct} percent of budget used`}
                        />
                        <span
                          className="absolute inset-0 flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: item.categoryColor || "#94a3b8" }}
                          />
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {item.categoryName}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatCurrency(item.spent)} / {formatCurrency(item.limit)}
                        </p>
                        <p
                          className={`text-xs font-semibold ${
                            item.status === "exceeded"
                              ? "text-red-500 dark:text-red-400"
                              : item.status === "warning"
                                ? "text-amber-500 dark:text-amber-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {item.status === "exceeded"
                            ? `${formatCurrency(item.spent - item.limit)} over`
                            : `${formatCurrency(left)} left`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Fade hint for scrollable content */}
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-card to-transparent pointer-events-none" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Month overview row ───────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balance</CardTitle>
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(data.totalBalance)}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.accounts.length} account
              {data.accounts.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(data.monthIncome)}
            </div>
            <p className="text-xs text-muted-foreground">{monthLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500 dark:text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCurrency(data.monthExpenses)}
            </div>
            <p className="text-xs text-muted-foreground">{monthLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net</CardTitle>
            <span className="text-xs font-medium text-muted-foreground">
              {monthLabel}
            </span>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                data.monthIncome - data.monthExpenses >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(data.monthIncome - data.monthExpenses)}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.monthIncome - data.monthExpenses >= 0 ? "Saved" : "Overspent"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom grid ──────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Spending Categories This Month */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Top Spending</CardTitle>
              <Link
                href="/insights"
                className="text-xs text-primary hover:underline flex items-center gap-0.5"
              >
                Insights <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <CardDescription>{monthLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No expenses this month yet.
              </p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const max = data.topCategories[0]?.total || 1;
                  return data.topCategories.map((cat, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-sm w-28 truncate">{cat.name}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(cat.total / max) * 100}%`,
                            backgroundColor: cat.color,
                          }}
                        />
                      </div>
                      <span className="text-sm font-semibold w-24 text-right tabular-nums">
                        {formatCurrency(cat.total)}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Balances */}
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>
              {data.accounts.length} account{data.accounts.length !== 1 ? "s" : ""} connected
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Landmark className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground">
                  No accounts yet. Add one on the Accounts page.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Landmark className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{account.name}</p>
                        <p className="text-xs capitalize text-muted-foreground">
                          {account.type}
                          {account.bankName ? ` \u00b7 ${account.bankName}` : ""}
                        </p>
                      </div>
                    </div>
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        account.currentBalance >= 0
                          ? "text-foreground"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCurrency(account.currentBalance)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
