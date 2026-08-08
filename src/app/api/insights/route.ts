import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categories, transactionGroups } from "@/db/schema";
import { eq, and, gte, lte, sql, inArray, type SQL } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { getStatsCutoff, isBeforeCutoff } from "@/lib/stat-reset";
import { trendWindow } from "@/lib/trend-window";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Months of history the monthly bars always cover, current month included. */
const TREND_MONTHS = 12;

/**
 * GET /api/insights — aggregated spending data for charts
 * Query params: dateFrom, dateTo, accountId, prevDateFrom, prevDateTo
 * Returns:
 *  - categoryBreakdown: spending per category incl. pot spend (for pie chart)
 *  - dailyTotals / monthlyTotals: income/expense per day/month, pot spend included
 *  - monthlyCategoryTotals: month × category expense matrix (for stacked chart)
 *  - summary: total income, total expenses, net, txCount
 *  - previous: same totals for the preceding range (null unless prevDateFrom+prevDateTo given)
 *  - topMerchants: top 10 by reimbursement-adjusted spend
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const prevDateFrom = searchParams.get("prevDateFrom");
    const prevDateTo = searchParams.get("prevDateTo");
    // accountId may be a comma-separated list of account ids
    const accountIds =
      searchParams.get("accountId")?.split(",").filter(Boolean) ?? [];

    const buildConditions = (from: string | null, to: string | null) => {
      const conds: SQL[] = [eq(transactions.userId, userId)];
      if (from) conds.push(gte(transactions.date, from));
      if (to) conds.push(lte(transactions.date, to));
      if (accountIds.length > 0)
        conds.push(inArray(transactions.accountId, accountIds));
      return conds;
    };

    // Direct (ungrouped) income/expense totals for a range. txCount only
    // counts real money movement (income/expense), not reimbursements etc.
    const directSummary = async (conds: SQL[]) => {
      const [row] = await db
        .select({
          totalIncome: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
          totalExpenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN (
            ${effectiveExpenseAmount()}
          ) ELSE 0 END)`,
          txCount: sql<number>`count(CASE WHEN ${transactions.type} IN ('income', 'expense') THEN 1 END)`,
        })
        .from(transactions)
        .where(and(sql`${transactions.groupId} IS NULL`, ...conds));
      return {
        totalIncome: row?.totalIncome ?? 0,
        totalExpenses: row?.totalExpenses ?? 0,
        txCount: row?.txCount ?? 0,
      };
    };

    // Direct (ungrouped) NET spend per category: reimbursement-adjusted expenses
    // minus income booked to the same category (a rent share paid back, say), so
    // a category reads the same net total the transactions page shows when you
    // filter on it. Categories that net to zero or less are dropped downstream.
    const directCategoryExpenses = (conds: SQL[]) =>
      db
        .select({
          categoryId: transactions.categoryId,
          total: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense'
            THEN (${effectiveExpenseAmount()}) ELSE -${transactions.amount} END)`,
          count: sql<number>`count(*)`,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.type, ["expense", "income"]),
            sql`${transactions.groupId} IS NULL`,
            ...conds,
          ),
        )
        .groupBy(transactions.categoryId);

    // Pot (transaction-group) spending per pot over a range: net spend floored
    // at 0 per pot (mirrors /api/budgets). Internal transfers don't count as
    // spending. categoryId may be null — uncategorized pot spend still counts.
    const potSpendingPerPot = (conds: SQL[]) =>
      db
        .select({
          categoryId: transactionGroups.categoryId,
          potTotal: sql<number>`${potSpentAmount()}`,
          count: sql<number>`count(*)`,
        })
        .from(transactionGroups)
        .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
        .where(
          and(
            sql`${transactions.type} != 'internal_transfer'`,
            ...conds,
          ),
        )
        .groupBy(transactionGroups.id, transactionGroups.categoryId);

    const conditions = buildConditions(dateFrom, dateTo);

    const [summary, catBreakdown, potSpendingRows] = await Promise.all([
      directSummary(conditions),
      directCategoryExpenses(conditions),
      potSpendingPerPot(conditions),
    ]);

    // Daily totals: direct rows plus pot activity per date. Pot deltas are
    // SIGNED (not floored): refunds/reimbursements inside pots reduce that
    // day's spend so month sums reconcile with the range-level summary (which
    // floors per pot over the whole range). Deliberate edge: a pot that nets
    // positive over the range floors to 0 in the summary but nets negative in
    // the time series — rare and accepted.
    // The monthly bars are a trend, so they always span a trailing year even
    // when the selected range is a single month — otherwise "Monthly" draws one
    // bar and says nothing. The time series is therefore queried over the union
    // of the range and that window; `dailyTotals` is trimmed back to the range
    // below so every other consumer stays range-scoped.
    const series = trendWindow(dateFrom, dateTo, TREND_MONTHS);
    const seriesConditions = buildConditions(series.from, series.to);

    const [directDaily, potDaily] = await Promise.all([
      db
        .select({
          date: transactions.date,
          income: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
          expenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN (
            ${effectiveExpenseAmount()}
          ) ELSE 0 END)`,
        })
        .from(transactions)
        .where(and(sql`${transactions.groupId} IS NULL`, ...seriesConditions))
        .groupBy(transactions.date),
      db
        .select({
          date: transactions.date,
          delta: sql<number>`-sum(${transactions.amount})`,
        })
        .from(transactionGroups)
        .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
        .where(
          and(
            sql`${transactions.type} != 'internal_transfer'`,
            ...seriesConditions,
          ),
        )
        .groupBy(transactions.date),
    ]);

    const dailyByDate = new Map(directDaily.map((d) => [d.date, { ...d }]));
    for (const p of potDaily) {
      const entry = dailyByDate.get(p.date) ?? {
        date: p.date,
        income: 0,
        expenses: 0,
      };
      entry.expenses += p.delta ?? 0;
      dailyByDate.set(p.date, entry);
    }
    const seriesDaily = [...dailyByDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    // Back to the selected range for the daily/weekly views and the summary.
    const dailyTotals = seriesDaily.filter(
      (d) => (!dateFrom || d.date >= dateFrom) && (!dateTo || d.date <= dateTo),
    );

    // Monthly totals derived from the merged dailies so they reconcile.
    const monthlyMap = new Map<
      string,
      { month: string; income: number; expenses: number }
    >();
    for (const d of seriesDaily) {
      const month = d.date.slice(0, 7);
      const m = monthlyMap.get(month) ?? { month, income: 0, expenses: 0 };
      m.income += d.income;
      m.expenses += d.expenses;
      monthlyMap.set(month, m);
    }
    const monthlyTotals = [...monthlyMap.values()];

    // Month × category expense matrix: direct net spend (same expense-minus-income
    // netting as the breakdown above) plus signed pot spend, merged in JS, each
    // (month, category) cell clamped at 0.
    const [directMonthlyCat, potMonthlyCat] = await Promise.all([
      db
        .select({
          month: sql<string>`substr(${transactions.date}, 1, 7)`,
          categoryId: transactions.categoryId,
          total: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense'
            THEN (${effectiveExpenseAmount()}) ELSE -${transactions.amount} END)`,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.type, ["expense", "income"]),
            sql`${transactions.groupId} IS NULL`,
            ...conditions,
          ),
        )
        .groupBy(
          sql`substr(${transactions.date}, 1, 7)`,
          transactions.categoryId,
        ),
      db
        .select({
          month: sql<string>`substr(${transactions.date}, 1, 7)`,
          categoryId: transactionGroups.categoryId,
          total: sql<number>`-sum(${transactions.amount})`,
        })
        .from(transactionGroups)
        .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
        .where(
          and(
            sql`${transactions.type} != 'internal_transfer'`,
            ...conditions,
          ),
        )
        .groupBy(
          sql`substr(${transactions.date}, 1, 7)`,
          transactionGroups.categoryId,
        ),
    ]);

    const monthCatMap = new Map<
      string,
      { month: string; categoryId: string | null; total: number }
    >();
    for (const row of [...directMonthlyCat, ...potMonthlyCat]) {
      const key = `${row.month}|${row.categoryId ?? ""}`;
      const cell = monthCatMap.get(key) ?? {
        month: row.month,
        categoryId: row.categoryId,
        total: 0,
      };
      cell.total += row.total ?? 0;
      monthCatMap.set(key, cell);
    }
    const monthlyCategoryTotals = [...monthCatMap.values()]
      .map((c) => ({ ...c, total: Math.max(c.total, 0) }))
      .filter((c) => c.total > 0)
      .sort((a, b) => a.month.localeCompare(b.month));

    // Top merchants by reimbursement-adjusted spend, grouped
    // case/whitespace-insensitively on description.
    const topMerchants = await db
      .select({
        description: sql<string>`MIN(${transactions.description})`,
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          ...conditions,
        ),
      )
      .groupBy(sql`lower(trim(${transactions.description}))`)
      .orderBy(sql`sum(${effectiveExpenseAmount()}) DESC`)
      .limit(10);

    // Merge pot totals into the category breakdown. Pot spend with a null
    // categoryId flows into the Uncategorized entry.
    type BreakdownEntry = {
      categoryId: string | null;
      categoryName: string | null;
      categoryColor: string | null;
      total: number;
      count: number;
    };
    const breakdownByCat = new Map<string, BreakdownEntry>();
    const addBreakdown = (
      categoryId: string | null,
      total: number,
      count: number,
    ) => {
      const key = categoryId ?? "none";
      const entry = breakdownByCat.get(key);
      if (entry) {
        entry.total += total;
        entry.count += count;
      } else {
        breakdownByCat.set(key, {
          categoryId,
          categoryName: null,
          categoryColor: null,
          total,
          count,
        });
      }
    };
    for (const c of catBreakdown)
      addBreakdown(c.categoryId, c.total ?? 0, c.count ?? 0);
    let totalPotSpending = 0;
    for (const row of potSpendingRows) {
      const amount = row.potTotal ?? 0;
      // Skip pots that netted zero/positive over the range: they contributed no
      // spend, so they shouldn't seed a phantom €0 category row.
      if (amount <= 0) continue;
      totalPotSpending += amount;
      addBreakdown(row.categoryId, amount, row.count ?? 0);
    }
    // Load meta for every category in the breakdown (some have only pot activity).
    const breakdownCatIds = [...breakdownByCat.keys()].filter(
      (k) => k !== "none",
    );
    if (breakdownCatIds.length > 0) {
      const metas = await db
        .select({
          id: categories.id,
          name: categories.name,
          color: categories.color,
        })
        .from(categories)
        .where(and(inArray(categories.id, breakdownCatIds), eq(categories.userId, userId)));
      for (const m of metas) {
        const entry = breakdownByCat.get(m.id);
        if (entry) {
          entry.categoryName = m.name;
          entry.categoryColor = m.color;
        }
      }
    }

    const totalExpensesWithPots = summary.totalExpenses + totalPotSpending;

    // Previous-period totals (same account filter, same range semantics as the
    // main summary/breakdown) for vs-previous deltas.
    //
    // A statistics reset ends the comparison: unless the whole previous period
    // sits after the cutoff it belongs to a different financial life, and a
    // delta against it would read as a real change when it is only the reset.
    // Clamping the period instead would compare a short window to a full one —
    // equally wrong. Return null and tell the client why.
    const statsCutoff = await getStatsCutoff(userId);
    const previousPredatesReset = isBeforeCutoff(prevDateFrom, statsCutoff);
    let previous: {
      totalIncome: number;
      totalExpenses: number;
      net: number;
      categoryTotals: Record<string, number>;
    } | null = null;
    if (
      prevDateFrom &&
      prevDateTo &&
      !previousPredatesReset &&
      ISO_DATE.test(prevDateFrom) &&
      ISO_DATE.test(prevDateTo)
    ) {
      const prevConditions = buildConditions(prevDateFrom, prevDateTo);
      const [prevSummary, prevCats, prevPots] = await Promise.all([
        directSummary(prevConditions),
        directCategoryExpenses(prevConditions),
        potSpendingPerPot(prevConditions),
      ]);
      const categoryTotals: Record<string, number> = {};
      for (const c of prevCats) {
        const key = c.categoryId ?? "none";
        categoryTotals[key] = (categoryTotals[key] ?? 0) + (c.total ?? 0);
      }
      let prevPotSpending = 0;
      for (const p of prevPots) {
        const key = p.categoryId ?? "none";
        const amount = p.potTotal ?? 0;
        categoryTotals[key] = (categoryTotals[key] ?? 0) + amount;
        prevPotSpending += amount;
      }
      // Same rule as the current-period breakdown: a category that nets to zero
      // or less isn't spending, so it compares as absent rather than negative.
      for (const [key, total] of Object.entries(categoryTotals))
        if (total <= 0) delete categoryTotals[key];
      const prevTotalExpenses = prevSummary.totalExpenses + prevPotSpending;
      previous = {
        totalIncome: prevSummary.totalIncome,
        totalExpenses: prevTotalExpenses,
        net: prevSummary.totalIncome - prevTotalExpenses,
        categoryTotals,
      };
    }

    return NextResponse.json({
      categoryBreakdown: [...breakdownByCat.values()]
        // Salary and other income-dominant categories net out to zero or less —
        // they're not places money went.
        .filter((c) => c.total > 0)
        .map((c) => ({
          categoryId: c.categoryId,
          categoryName: c.categoryName || "Uncategorized",
          categoryColor: c.categoryColor || "#94a3b8",
          total: c.total,
          count: c.count,
        })),
      dailyTotals,
      monthlyTotals,
      monthlyCategoryTotals,
      summary: {
        totalIncome: summary.totalIncome,
        totalExpenses: totalExpensesWithPots,
        net: summary.totalIncome - totalExpensesWithPots,
        txCount: summary.txCount,
      },
      previous,
      statsCutoff,
      previousPredatesReset,
      topMerchants: topMerchants.map((m) => ({
        description: m.description,
        total: m.total,
        count: m.count,
      })),
    });
  }, "Failed to fetch insights");
}
