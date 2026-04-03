import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  budgets,
  categories,
  transactions,
  recurringTransactions,
} from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

/**
 * Get current month date range
 */
function getCurrentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * Calculate monthly equivalent for a recurring transaction
 */
function toMonthly(amount: number, frequency: string): number {
  switch (frequency) {
    case "weekly":
      return Math.abs(amount) * 4.33;
    case "biweekly":
      return Math.abs(amount) * 2.17;
    case "monthly":
      return Math.abs(amount);
    case "yearly":
      return Math.abs(amount) / 12;
    default:
      return Math.abs(amount);
  }
}

/**
 * GET /api/budgets — unified budget view
 *
 * Returns:
 *  - monthlyIncome: total from recurring income
 *  - fixedCosts: categories with recurring expenses (auto-populated)
 *  - allocations: user-defined budget allocations for variable categories
 *  - unallocated: remaining amount not yet assigned
 *  - each allocation includes actual spending this month
 */
export async function GET() {
  try {
    const { from, to } = getCurrentMonthRange();

    // 1. Get recurring income (monthly equivalent)
    const recurringIncome = await db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.type, "income"),
          eq(recurringTransactions.isActive, true)
        )
      );

    const monthlyIncome = recurringIncome.reduce(
      (sum, r) => sum + toMonthly(r.amount, r.frequency),
      0
    );

    // 2. Get recurring expenses grouped by category
    const recurringExpenses = await db
      .select({
        categoryId: recurringTransactions.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        amount: recurringTransactions.amount,
        frequency: recurringTransactions.frequency,
        description: recurringTransactions.description,
      })
      .from(recurringTransactions)
      .leftJoin(
        categories,
        eq(recurringTransactions.categoryId, categories.id)
      )
      .where(
        and(
          eq(recurringTransactions.type, "expense"),
          eq(recurringTransactions.isActive, true)
        )
      );

    // Group recurring expenses by category
    const fixedCostMap = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        categoryColor: string;
        monthlyAmount: number;
        items: { description: string; monthlyAmount: number }[];
      }
    >();

    for (const r of recurringExpenses) {
      const catId = r.categoryId || "uncategorized";
      const existing = fixedCostMap.get(catId);
      const monthly = toMonthly(r.amount, r.frequency);
      if (existing) {
        existing.monthlyAmount += monthly;
        existing.items.push({ description: r.description, monthlyAmount: monthly });
      } else {
        fixedCostMap.set(catId, {
          categoryId: catId,
          categoryName: r.categoryName || "Uncategorized",
          categoryColor: r.categoryColor || "#94a3b8",
          monthlyAmount: monthly,
          items: [{ description: r.description, monthlyAmount: monthly }],
        });
      }
    }

    const fixedCosts = Array.from(fixedCostMap.values());
    const totalFixedCosts = fixedCosts.reduce(
      (s, c) => s + c.monthlyAmount,
      0
    );

    // 3. Get user-defined budget allocations
    const allAllocations = await db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        amount: budgets.amount,
        period: budgets.period,
        isActive: budgets.isActive,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id));

    // 4. Calculate actual spending per allocated category this month
    const allocationsWithSpending = await Promise.all(
      allAllocations.map(async (alloc) => {
        const spentResult = await db
          .select({
            total: sql<number>`sum(abs(${transactions.amount}))`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.categoryId, alloc.categoryId),
              eq(transactions.type, "expense"),
              gte(transactions.date, from),
              lte(transactions.date, to)
            )
          );

        const spent = spentResult[0]?.total || 0;
        const percentage =
          alloc.amount > 0 ? (spent / alloc.amount) * 100 : 0;

        return {
          ...alloc,
          spent,
          remaining: Math.max(0, alloc.amount - spent),
          percentage: Math.round(percentage * 10) / 10,
          status:
            percentage >= 100
              ? "exceeded"
              : percentage >= 80
                ? "warning"
                : ("ok" as "ok" | "warning" | "exceeded"),
        };
      })
    );

    // Also compute spending for fixed cost categories this month
    const fixedCostsWithSpending = await Promise.all(
      fixedCosts.map(async (fc) => {
        if (fc.categoryId === "uncategorized") return { ...fc, spent: 0 };
        const spentResult = await db
          .select({
            total: sql<number>`sum(abs(${transactions.amount}))`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.categoryId, fc.categoryId),
              eq(transactions.type, "expense"),
              gte(transactions.date, from),
              lte(transactions.date, to)
            )
          );
        return { ...fc, spent: spentResult[0]?.total || 0 };
      })
    );

    // 5. Calculate average monthly spending per category (across all past complete months)
    const monthlySpendingByCategory = await db
      .select({
        categoryId: transactions.categoryId,
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        total: sql<number>`sum(abs(${transactions.amount}))`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "expense"),
          // Exclude current month — only completed months
          sql`substr(${transactions.date}, 1, 7) < ${from.slice(0, 7)}`
        )
      )
      .groupBy(transactions.categoryId, sql`substr(${transactions.date}, 1, 7)`);

    // Build map: categoryId -> { totalSpent, monthCount, avgMonthly }
    const avgSpendingMap = new Map<string, { totalSpent: number; monthCount: number; avgMonthly: number }>();
    const categoryMonths = new Map<string, Set<string>>();

    for (const row of monthlySpendingByCategory) {
      const catId = row.categoryId || "uncategorized";
      if (!categoryMonths.has(catId)) categoryMonths.set(catId, new Set());
      categoryMonths.get(catId)!.add(row.month);

      const existing = avgSpendingMap.get(catId);
      if (existing) {
        existing.totalSpent += row.total;
      } else {
        avgSpendingMap.set(catId, { totalSpent: row.total, monthCount: 0, avgMonthly: 0 });
      }
    }

    // Finalize averages
    for (const [catId, data] of avgSpendingMap) {
      data.monthCount = categoryMonths.get(catId)?.size || 1;
      data.avgMonthly = Math.round((data.totalSpent / data.monthCount) * 100) / 100;
    }

    // Attach avgMonthly to allocations and fixed costs
    const allocationsWithAvg = allocationsWithSpending.map((a) => ({
      ...a,
      avgMonthly: avgSpendingMap.get(a.categoryId)?.avgMonthly || 0,
      avgMonths: avgSpendingMap.get(a.categoryId)?.monthCount || 0,
    }));

    const fixedCostsWithAvg = fixedCostsWithSpending.map((fc) => ({
      ...fc,
      avgMonthly: avgSpendingMap.get(fc.categoryId)?.avgMonthly || 0,
      avgMonths: avgSpendingMap.get(fc.categoryId)?.monthCount || 0,
    }));

    // Also provide averages for all categories (for the add-allocation dialog)
    const allCategoryAvgs: Record<string, number> = {};
    for (const [catId, data] of avgSpendingMap) {
      allCategoryAvgs[catId] = data.avgMonthly;
    }

    const totalAllocated = allAllocations.reduce(
      (s, a) => s + a.amount,
      0
    );
    const availableToAllocate = monthlyIncome - totalFixedCosts;
    const unallocated = availableToAllocate - totalAllocated;

    return NextResponse.json({
      monthlyIncome: Math.round(monthlyIncome * 100) / 100,
      totalFixedCosts: Math.round(totalFixedCosts * 100) / 100,
      availableToAllocate: Math.round(availableToAllocate * 100) / 100,
      totalAllocated: Math.round(totalAllocated * 100) / 100,
      unallocated: Math.round(unallocated * 100) / 100,
      fixedCosts: fixedCostsWithAvg,
      allocations: allocationsWithAvg,
      categoryAverages: allCategoryAvgs,
      month: {
        from,
        to,
        label: new Date(from).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
      },
    });
  } catch (error) {
    console.error("Failed to fetch budget:", error);
    return NextResponse.json(
      { error: "Failed to fetch budget" },
      { status: 500 }
    );
  }
}

// POST /api/budgets — create a budget allocation for a category
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categoryId, amount } = body;

    if (!categoryId || amount === undefined) {
      return NextResponse.json(
        { error: "categoryId and amount are required" },
        { status: 400 }
      );
    }

    // Check if allocation already exists
    const existing = await db
      .select()
      .from(budgets)
      .where(eq(budgets.categoryId, categoryId));

    if (existing.length > 0) {
      // Update existing
      await db
        .update(budgets)
        .set({ amount })
        .where(eq(budgets.categoryId, categoryId));
      return NextResponse.json({ success: true, id: existing[0].id });
    }

    const id = crypto.randomUUID();
    await db.insert(budgets).values({
      id,
      categoryId,
      amount,
      period: "monthly",
      isActive: true,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create/update allocation:", error);
    return NextResponse.json(
      { error: "Failed to create/update allocation" },
      { status: 500 }
    );
  }
}

// PUT /api/budgets — update a budget allocation
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, amount } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Budget ID is required" },
        { status: 400 }
      );
    }

    await db
      .update(budgets)
      .set({ amount })
      .where(eq(budgets.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update allocation:", error);
    return NextResponse.json(
      { error: "Failed to update allocation" },
      { status: 500 }
    );
  }
}

// DELETE /api/budgets — delete a budget allocation
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Budget ID is required" },
        { status: 400 }
      );
    }

    await db.delete(budgets).where(eq(budgets.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete allocation:", error);
    return NextResponse.json(
      { error: "Failed to delete allocation" },
      { status: 500 }
    );
  }
}
