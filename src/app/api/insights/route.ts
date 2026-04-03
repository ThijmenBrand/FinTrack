import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categories } from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

/**
 * GET /api/insights — aggregated spending data for charts
 * Query params: dateFrom, dateTo
 * Returns:
 *  - categoryBreakdown: spending per category (for pie chart)
 *  - dailyTotals: income/expense per day (for bar chart)
 *  - monthlyTotals: income/expense per month (for trend chart)
 *  - summary: total income, total expenses, net
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Build date conditions
    const conditions = [];
    if (dateFrom) conditions.push(gte(transactions.date, dateFrom));
    if (dateTo) conditions.push(lte(transactions.date, dateTo));

    const dateWhere =
      conditions.length > 0 ? and(...conditions) : undefined;

    // 1. Category breakdown (expenses only, excluding internal transfers)
    const catBreakdown = await db
      .select({
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        total: sql<number>`sum(abs(${transactions.amount}))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        dateWhere
          ? and(eq(transactions.type, "expense"), ...conditions)
          : eq(transactions.type, "expense")
      )
      .groupBy(transactions.categoryId);

    // 2. Daily totals
    const dailyTotals = await db
      .select({
        date: transactions.date,
        income: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
        expenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN abs(${transactions.amount}) ELSE 0 END)`,
      })
      .from(transactions)
      .where(dateWhere)
      .groupBy(transactions.date)
      .orderBy(transactions.date);

    // 3. Monthly totals
    const monthlyTotals = await db
      .select({
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        income: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
        expenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN abs(${transactions.amount}) ELSE 0 END)`,
      })
      .from(transactions)
      .where(dateWhere)
      .groupBy(sql`substr(${transactions.date}, 1, 7)`)
      .orderBy(sql`substr(${transactions.date}, 1, 7)`);

    // 4. Summary
    const summaryResult = await db
      .select({
        totalIncome: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
        totalExpenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN abs(${transactions.amount}) ELSE 0 END)`,
        txCount: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(dateWhere);

    const summary = summaryResult[0] || {
      totalIncome: 0,
      totalExpenses: 0,
      txCount: 0,
    };

    // 5. Top merchants (by spending)
    const topMerchants = await db
      .select({
        description: transactions.description,
        total: sql<number>`sum(abs(${transactions.amount}))`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        dateWhere
          ? and(eq(transactions.type, "expense"), ...conditions)
          : eq(transactions.type, "expense")
      )
      .groupBy(transactions.description)
      .orderBy(sql`sum(abs(${transactions.amount})) DESC`)
      .limit(10);

    return NextResponse.json({
      categoryBreakdown: catBreakdown.map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName || "Uncategorized",
        categoryColor: c.categoryColor || "#94a3b8",
        total: c.total,
        count: c.count,
      })),
      dailyTotals: dailyTotals.map((d) => ({
        date: d.date,
        income: d.income,
        expenses: d.expenses,
      })),
      monthlyTotals: monthlyTotals.map((m) => ({
        month: m.month,
        income: m.income,
        expenses: m.expenses,
      })),
      summary: {
        totalIncome: summary.totalIncome,
        totalExpenses: summary.totalExpenses,
        net: summary.totalIncome - summary.totalExpenses,
        txCount: summary.txCount,
      },
      topMerchants: topMerchants.map((m) => ({
        description: m.description,
        total: m.total,
        count: m.count,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch insights:", error);
    return NextResponse.json(
      { error: "Failed to fetch insights" },
      { status: 500 }
    );
  }
}
