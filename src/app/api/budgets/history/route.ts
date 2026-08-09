import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { budgets, categories, transactions, transactionGroups } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { accountScopeFilter, resolveBudgetPlan } from "@/lib/budget-plan";
import { getI18n } from "@/lib/i18n/server";

export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { intlLocale } = await getI18n();
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const budgetIdParam = searchParams.get("budgetId");

    if (!categoryId) {
      return NextResponse.json(
        { error: "categoryId is required" },
        { status: 400 }
      );
    }

    // History is per plan: the budget line and the spending both come from
    // the plan's own allocations and accounts (main plan when unspecified).
    const plan = await resolveBudgetPlan(userId, budgetIdParam);
    if (budgetIdParam && !plan) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }
    const scopeFilter = accountScopeFilter(plan ? plan.accountIds : undefined);

    // Get category info
    const [category] = await db
      .select({ id: categories.id, name: categories.name, color: categories.color })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));

    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }

    // Get current budget amount for this category
    const [budget] = await db
      .select({ amount: budgets.amount })
      .from(budgets)
      .where(
        and(
          eq(budgets.categoryId, categoryId),
          eq(budgets.userId, userId),
          eq(budgets.status, "active"),
          ...(plan ? [eq(budgets.budgetId, plan.id)] : []),
        ),
      );

    const currentBudgetAmount = budget?.amount || 0;

    // Get monthly spending summaries grouped by month (excluding grouped transactions)
    const monthlySpending = await db
      .select({
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        spent: sql<number>`sum(${effectiveExpenseAmount()})`,
        transactionCount: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.categoryId, categoryId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          eq(transactions.userId, userId),
          ...(scopeFilter ? [scopeFilter] : []),
        )
      )
      .groupBy(sql`substr(${transactions.date}, 1, 7)`)
      .orderBy(sql`substr(${transactions.date}, 1, 7) desc`);

    // Get monthly pot spending for this category (pots with matching categoryId)
    const potMonthlySpending = await db
      .select({
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        potTotal: sql<number>`${potSpentAmount()}`,
        potId: transactionGroups.id,
      })
      .from(transactionGroups)
      .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
      .where(
        and(
          eq(transactionGroups.categoryId, categoryId),
          eq(transactionGroups.userId, userId),
          eq(transactions.userId, userId),
          ...(scopeFilter ? [scopeFilter] : []),
        ),
      )
      .groupBy(transactionGroups.id, sql`substr(${transactions.date}, 1, 7)`)
      .orderBy(sql`substr(${transactions.date}, 1, 7) desc`);

    // Aggregate pot spending per month
    const potSpendingByMonth = new Map<string, number>();
    for (const row of potMonthlySpending) {
      const existing = potSpendingByMonth.get(row.month) || 0;
      potSpendingByMonth.set(row.month, existing + row.potTotal);
    }

    // Merge pot spending into monthly spending
    const allMonths = new Set([
      ...monthlySpending.map((r) => r.month),
      ...potSpendingByMonth.keys(),
    ]);

    const mergedSpending = Array.from(allMonths)
      .sort((a, b) => b.localeCompare(a))
      .map((month) => {
        const txRow = monthlySpending.find((r) => r.month === month);
        const txSpent = txRow?.spent || 0;
        const txCount = txRow?.transactionCount || 0;
        const potSpent = potSpendingByMonth.get(month) || 0;
        return {
          month,
          spent: txSpent + potSpent,
          transactionCount: txCount,
        };
      });

    // Current month for tagging
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const months = mergedSpending.map((row) => {
      const percentage = currentBudgetAmount > 0
        ? Math.round((row.spent / currentBudgetAmount) * 1000) / 10
        : 0;

      // Parse month for label
      const [year, monthNum] = row.month.split("-");
      const monthDate = new Date(parseInt(year), parseInt(monthNum) - 1, 1);
      const label = monthDate.toLocaleDateString(intlLocale, {
        month: "long",
        year: "numeric",
      });

      return {
        month: row.month,
        label,
        spent: Math.round(row.spent * 100) / 100,
        transactionCount: row.transactionCount,
        percentage,
        status: (percentage >= 100 ? "exceeded" : percentage >= 80 ? "warning" : "ok") as
          | "ok"
          | "warning"
          | "exceeded",
        isCurrent: row.month === currentMonth,
      };
    });

    return NextResponse.json({
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      currentBudgetAmount,
      months,
    });
  }, "Failed to fetch budget history");
}
