import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, categories, transactionGroups } from "@/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

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
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const accountId = searchParams.get("accountId");

    // Build date conditions
    const conditions = [eq(transactions.userId, userId)];
    if (dateFrom) conditions.push(gte(transactions.date, dateFrom));
    if (dateTo) conditions.push(lte(transactions.date, dateTo));
    if (accountId) conditions.push(eq(transactions.accountId, accountId));

    const dateWhere =
      conditions.length > 0 ? and(...conditions) : undefined;

    // 1. Category breakdown (expenses only, excluding internal transfers, effective amounts)
    const catBreakdown = await db
      .select({
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        total: sql<number>`sum(
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        )`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          ...conditions
        )
      )
      .groupBy(transactions.categoryId);

    // 2. Daily totals (exclude reimbursements from income, grouped, use effective expense amounts)
    const dailyTotals = await db
      .select({
        date: transactions.date,
        income: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
        expenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN (
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        ) ELSE 0 END)`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), sql`${transactions.groupId} IS NULL`, dateWhere))
      .groupBy(transactions.date)
      .orderBy(transactions.date);

    // 3. Monthly totals (exclude reimbursements from income, grouped, use effective expense amounts)
    const monthlyTotals = await db
      .select({
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        income: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
        expenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN (
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        ) ELSE 0 END)`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), sql`${transactions.groupId} IS NULL`, dateWhere))
      .groupBy(sql`substr(${transactions.date}, 1, 7)`)
      .orderBy(sql`substr(${transactions.date}, 1, 7)`);

    // 4. Summary (exclude reimbursements from income, grouped, use effective expense amounts)
    const summaryResult = await db
      .select({
        totalIncome: sql<number>`sum(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END)`,
        totalExpenses: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense' THEN (
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        ) ELSE 0 END)`,
        txCount: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), sql`${transactions.groupId} IS NULL`, dateWhere));

    const summary = summaryResult[0] || {
      totalIncome: 0,
      totalExpenses: 0,
      txCount: 0,
    };

    // 5. Top merchants (by spending, excluding internal transfers, effective amounts)
    const topMerchants = await db
      .select({
        description: transactions.description,
        total: sql<number>`sum(
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        )`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          ...conditions
        )
      )
      .groupBy(transactions.description)
      .orderBy(sql`sum(abs(${transactions.amount})) DESC`)
      .limit(10);

    // Pot (transaction-group) spending per category. Mirrors /api/budgets so
    // the Expenses card and Budget Performance reflect the same period spend.
    // Reserved deposits and internal transfers don't count as spending.
    const potSpendingRows = await db
      .select({
        categoryId: transactionGroups.categoryId,
        potTotal: sql<number>`abs(sum(${transactions.amount}))`,
      })
      .from(transactionGroups)
      .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
      .where(
        and(
          sql`${transactionGroups.categoryId} IS NOT NULL`,
          sql`${transactions.type} NOT IN ('reserved', 'internal_transfer')`,
          dateWhere,
        ),
      )
      .groupBy(transactionGroups.id, transactionGroups.categoryId);

    const potSpendingByCategory = new Map<string, number>();
    let totalPotSpending = 0;
    for (const row of potSpendingRows) {
      if (!row.categoryId) continue;
      const amount = row.potTotal ?? 0;
      potSpendingByCategory.set(
        row.categoryId,
        (potSpendingByCategory.get(row.categoryId) || 0) + amount,
      );
      totalPotSpending += amount;
    }

    // Merge pot totals into the category breakdown. Categories that only have
    // pot activity (no direct expense rows) need their meta loaded.
    type BreakdownEntry = {
      categoryId: string | null;
      categoryName: string | null;
      categoryColor: string | null;
      total: number;
      count: number;
    };
    const breakdownByCat = new Map<string, BreakdownEntry>();
    for (const c of catBreakdown) {
      if (c.categoryId) breakdownByCat.set(c.categoryId, { ...c });
    }
    const missingCatIds = Array.from(potSpendingByCategory.keys()).filter(
      (id) => !breakdownByCat.has(id),
    );
    if (missingCatIds.length > 0) {
      const missingCats = await db
        .select({
          id: categories.id,
          name: categories.name,
          color: categories.color,
        })
        .from(categories)
        .where(inArray(categories.id, missingCatIds));
      for (const m of missingCats) {
        breakdownByCat.set(m.id, {
          categoryId: m.id,
          categoryName: m.name,
          categoryColor: m.color,
          total: 0,
          count: 0,
        });
      }
    }
    for (const [catId, potTotal] of potSpendingByCategory) {
      const entry = breakdownByCat.get(catId);
      if (entry) entry.total += potTotal;
    }

    const mergedBreakdown: BreakdownEntry[] = [
      ...breakdownByCat.values(),
      ...catBreakdown.filter((c) => !c.categoryId),
    ];

    const totalExpensesWithPots = summary.totalExpenses + totalPotSpending;

    return NextResponse.json({
      categoryBreakdown: mergedBreakdown.map((c) => ({
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
        totalExpenses: totalExpensesWithPots,
        net: summary.totalIncome - totalExpensesWithPots,
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
