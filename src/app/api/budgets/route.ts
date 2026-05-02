import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  budgets,
  categories,
  transactions,
  recurringTransactions,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { isRegenerationDue } from "@/lib/auto-budget";
import { getUserPreferences } from "@/lib/preferences";

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AVG_DAYS_PER_MONTH = 30.4375;

function rangeLabel(from: string, to: string): string {
  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  const sameYear = fromDate.getFullYear() === toDate.getFullYear();
  const sameMonth = sameYear && fromDate.getMonth() === toDate.getMonth();

  // Single calendar month covering its full span: "May 2026"
  if (
    sameMonth &&
    fromDate.getDate() === 1 &&
    toDate.getDate() ===
      new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0).getDate()
  ) {
    return fromDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  const monthFmt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const fromStr = fromDate.toLocaleDateString("en-US", monthFmt);
  const toStr = toDate.toLocaleDateString("en-US", {
    ...monthFmt,
    year: "numeric",
  });
  return `${fromStr} – ${toStr}`;
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
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const dateFromParam = searchParams.get("dateFrom");
    const dateToParam = searchParams.get("dateTo");
    const noScaleParam = searchParams.get("noScale");
    const noScale = noScaleParam === "1" || noScaleParam === "true";

    // Use the requested range when both dates are present and well-formed;
    // otherwise default to the current calendar month.
    const useRange =
      !!dateFromParam &&
      !!dateToParam &&
      ISO_DATE.test(dateFromParam) &&
      ISO_DATE.test(dateToParam) &&
      dateFromParam <= dateToParam;
    const { from, to } = useRange
      ? { from: dateFromParam!, to: dateToParam! }
      : getCurrentMonthRange();

    // Scale monthly budget figures so they're comparable to spending in the range.
    // E.g. a 3-month range scales the monthly cap ×3 so spent-vs-budget is apples-to-apples.
    // Only applied when the caller passed an explicit range — without it (the Budgets page),
    // amounts stay at their stored monthly values. `noScale=1` opts out even with a range,
    // which the Budgets page uses when viewing a single financial month.
    const fromTime = new Date(from + "T00:00:00").getTime();
    const toTime = new Date(to + "T00:00:00").getTime();
    const daysInRange = Math.max(1, (toTime - fromTime) / 86_400_000 + 1);
    const monthsScale =
      useRange && !noScale ? daysInRange / AVG_DAYS_PER_MONTH : 1;

    // 0. Get pot spending by category for current month
    // Each pot's net amount (abs of sum of member transactions) counts toward the pot's category
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
          gte(transactions.date, from),
          lte(transactions.date, to),
          eq(transactions.userId, userId),
        ),
      )
      .groupBy(transactionGroups.id, transactionGroups.categoryId);

    // Aggregate pot spending per category (multiple pots can share a category)
    const potSpendingByCategory = new Map<string, number>();
    for (const row of potSpendingRows) {
      if (row.categoryId) {
        const existing = potSpendingByCategory.get(row.categoryId) || 0;
        potSpendingByCategory.set(row.categoryId, existing + row.potTotal);
      }
    }

    // 1. Get recurring income (monthly equivalent)
    const recurringIncome = await db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.type, "income"),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.userId, userId),
        ),
      );

    const monthlyIncome = recurringIncome.reduce(
      (sum, r) => sum + toMonthly(r.amount, r.frequency),
      0,
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
      .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
      .where(
        and(
          eq(recurringTransactions.type, "expense"),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.userId, userId),
        ),
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
        existing.items.push({
          description: r.description,
          monthlyAmount: monthly,
        });
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
    const totalFixedCosts = fixedCosts.reduce((s, c) => s + c.monthlyAmount, 0);

    // 3. Get user-defined budget allocations (active only — suggestions are returned separately).
    // Reserved-kind categories don't have spending limits; they are returned via
    // a separate `reserved` array built from kind='reserved' categories below.
    const allAllocationsRaw = await db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        categoryKind: categories.kind,
        amount: budgets.amount,
        period: budgets.period,
        isActive: budgets.isActive,
        source: budgets.source,
        generatedAt: budgets.generatedAt,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id))
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.status, "active"),
          eq(budgets.isActive, true),
        ),
      );

    const allAllocations = allAllocationsRaw.filter(
      (a) => a.categoryKind !== "reserved",
    );

    // Reserved categories drive the "Reserved" section. Funded amount comes
    // from actual type='reserved' transactions this month. An optional
    // monthly target — stored as a budget on the reserved category — acts
    // as a planned reservation.
    const reservedCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
      })
      .from(categories)
      .where(
        and(eq(categories.userId, userId), eq(categories.kind, "reserved")),
      );

    const reservedTargetByCategory = new Map<string, number>();
    for (const a of allAllocationsRaw) {
      if (a.categoryKind === "reserved") {
        reservedTargetByCategory.set(a.categoryId, a.amount);
      }
    }

    // 3b. Get pending suggestions (system-generated proposals)
    const suggestionRows = await db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        amount: budgets.amount,
        generatedAt: budgets.generatedAt,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id))
      .where(and(eq(budgets.userId, userId), eq(budgets.status, "suggested")));

    // 4. Calculate actual spending per category for the current month in a
    // single grouped query (effective amounts, exclude grouped). We then look
    // up per allocation / fixed cost from the resulting map.
    const monthSpendRows = await db
      .select({
        categoryId: transactions.categoryId,
        total: sql<number>`sum(
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        )`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to),
        ),
      )
      .groupBy(transactions.categoryId);

    const monthSpendByCategory = new Map<string, number>();
    for (const row of monthSpendRows) {
      if (!row.categoryId) continue;
      monthSpendByCategory.set(row.categoryId, row.total ?? 0);
    }

    // 3c. Reserved amount per category for the current month — sum of
    // |amount| for type='reserved' transactions. Dynamic, no budget needed.
    const reservedCategoryIds = reservedCategories.map((c) => c.id);
    const reservedFundedByCategory = new Map<string, number>();
    if (reservedCategoryIds.length > 0) {
      const reservedFundedRows = await db
        .select({
          categoryId: transactions.categoryId,
          total: sql<number>`sum(abs(${transactions.amount}))`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, "reserved"),
            inArray(transactions.categoryId, reservedCategoryIds),
            gte(transactions.date, from),
            lte(transactions.date, to),
          ),
        )
        .groupBy(transactions.categoryId);
      for (const row of reservedFundedRows) {
        if (row.categoryId)
          reservedFundedByCategory.set(row.categoryId, row.total ?? 0);
      }
    }

    const allocationsWithSpending = allAllocations.map((alloc) => {
      const scaledAmount = alloc.amount * monthsScale;
      const txSpent = monthSpendByCategory.get(alloc.categoryId) || 0;
      const potSpent = potSpendingByCategory.get(alloc.categoryId) || 0;
      const spent = txSpent + potSpent;
      const percentage = scaledAmount > 0 ? (spent / scaledAmount) * 100 : 0;
      return {
        ...alloc,
        amount: scaledAmount,
        spent,
        remaining: Math.max(0, scaledAmount - spent),
        percentage: Math.round(percentage * 10) / 10,
        status:
          percentage >= 100
            ? "exceeded"
            : percentage >= 80
              ? "warning"
              : ("ok" as "ok" | "warning" | "exceeded"),
      };
    });

    const fixedCostsWithSpending = fixedCosts.map((fc) => {
      const scaledMonthly = fc.monthlyAmount * monthsScale;
      if (fc.categoryId === "uncategorized") {
        return { ...fc, monthlyAmount: scaledMonthly, spent: 0 };
      }
      const txSpent = monthSpendByCategory.get(fc.categoryId) || 0;
      const potSpent = potSpendingByCategory.get(fc.categoryId) || 0;
      return { ...fc, monthlyAmount: scaledMonthly, spent: txSpent + potSpent };
    });

    // 5. Calculate average monthly spending per category (across all past complete months)
    // Must match the current-month logic: exclude grouped transactions, subtract reimbursements
    const monthlySpendingByCategory = await db
      .select({
        categoryId: transactions.categoryId,
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        total: sql<number>`sum(
          abs(${transactions.amount}) - COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id" WHERE rl.expense_id = "transactions"."id"),
            0
          )
        )`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          // Exclude current month — only completed months
          sql`substr(${transactions.date}, 1, 7) < ${from.slice(0, 7)}`,
          eq(transactions.userId, userId),
        ),
      )
      .groupBy(
        transactions.categoryId,
        sql`substr(${transactions.date}, 1, 7)`,
      );

    // Build map: categoryId -> { totalSpent, monthCount, avgMonthly }
    const avgSpendingMap = new Map<
      string,
      { totalSpent: number; monthCount: number; avgMonthly: number }
    >();
    const categoryMonths = new Map<string, Set<string>>();

    for (const row of monthlySpendingByCategory) {
      const catId = row.categoryId || "uncategorized";
      if (!categoryMonths.has(catId)) categoryMonths.set(catId, new Set());
      categoryMonths.get(catId)!.add(row.month);

      const existing = avgSpendingMap.get(catId);
      if (existing) {
        existing.totalSpent += row.total;
      } else {
        avgSpendingMap.set(catId, {
          totalSpent: row.total,
          monthCount: 0,
          avgMonthly: 0,
        });
      }
    }

    // Finalize averages
    for (const [catId, data] of avgSpendingMap) {
      data.monthCount = categoryMonths.get(catId)?.size || 1;
      data.avgMonthly =
        Math.round((data.totalSpent / data.monthCount) * 100) / 100;
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

    const totalAllocatedMonthly = allAllocations.reduce(
      (s, a) => s + a.amount,
      0,
    );
    const scaledMonthlyIncome = monthlyIncome * monthsScale;
    const scaledTotalFixedCosts = totalFixedCosts * monthsScale;
    const totalAllocated = totalAllocatedMonthly * monthsScale;
    // Per-category reservation = max(actual, target). Matches month-money math
    // so Free to Spend and the Budgets page agree.
    let totalReserved = 0;
    const reservedRowsBuilt = reservedCategories.map((c) => {
      const funded = reservedFundedByCategory.get(c.id) || 0;
      const target = reservedTargetByCategory.get(c.id) ?? null;
      const effective = Math.max(funded, target ?? 0);
      totalReserved += effective;
      return {
        categoryId: c.id,
        categoryName: c.name,
        categoryColor: c.color,
        funded: Math.round(funded * 100) / 100,
        target: target !== null ? Math.round(target * 100) / 100 : null,
      };
    });
    const availableToAllocate = monthlyIncome - totalFixedCosts - totalReserved;
    const unallocated = availableToAllocate - totalAllocated;

    const reserved = reservedRowsBuilt.sort((a, b) => {
      // Sort by target if set, otherwise by funded — keeps planned categories
      // visually anchored.
      const aWeight = a.target ?? a.funded;
      const bWeight = b.target ?? b.funded;
      return bWeight - aWeight;
    });

    // Build set of "tracked" category IDs (those with an allocation or fixed cost)
    const trackedCatIds = new Set<string>();
    for (const a of allAllocations) trackedCatIds.add(a.categoryId);
    for (const fc of fixedCosts) {
      if (fc.categoryId !== "uncategorized") trackedCatIds.add(fc.categoryId);
    }

    // Unbudgeted spending: per-category spend (transactions + pots) for categories not tracked
    const unbudgetedSpentByCategory = new Map<string, number>();
    for (const [catId, amount] of monthSpendByCategory) {
      if (!trackedCatIds.has(catId)) {
        unbudgetedSpentByCategory.set(
          catId,
          (unbudgetedSpentByCategory.get(catId) || 0) + amount,
        );
      }
    }
    for (const [catId, amount] of potSpendingByCategory) {
      if (!trackedCatIds.has(catId)) {
        unbudgetedSpentByCategory.set(
          catId,
          (unbudgetedSpentByCategory.get(catId) || 0) + amount,
        );
      }
    }

    const unbudgetedCatIds = Array.from(unbudgetedSpentByCategory.keys());
    const unbudgetedCategoryRows =
      unbudgetedCatIds.length > 0
        ? await db
            .select({
              id: categories.id,
              name: categories.name,
              color: categories.color,
            })
            .from(categories)
            .where(inArray(categories.id, unbudgetedCatIds))
        : [];
    const unbudgetedCategoryMeta = new Map<
      string,
      { name: string; color: string }
    >();
    for (const row of unbudgetedCategoryRows) {
      unbudgetedCategoryMeta.set(row.id, {
        name: row.name,
        color: row.color || "#94a3b8",
      });
    }

    const unbudgetedSpending = unbudgetedCatIds
      .map((catId) => {
        const meta = unbudgetedCategoryMeta.get(catId);
        return {
          categoryId: catId,
          categoryName: meta?.name || "Uncategorized",
          categoryColor: meta?.color || "#94a3b8",
          spent:
            Math.round((unbudgetedSpentByCategory.get(catId) || 0) * 100) / 100,
        };
      })
      .sort((a, b) => b.spent - a.spent);

    // Total spending this month — matches inclusion rules used for allocation/fixed cost spent
    let totalSpentThisMonth = 0;
    for (const amount of monthSpendByCategory.values())
      totalSpentThisMonth += amount;
    for (const amount of potSpendingByCategory.values())
      totalSpentThisMonth += amount;
    const totalBudget = scaledTotalFixedCosts + totalAllocated;

    // Build suggestion DTOs with per-category context (current amount, avg).
    const activeAmountByCategory = new Map<string, number>();
    for (const a of allAllocations)
      activeAmountByCategory.set(a.categoryId, a.amount);
    const suggestions = suggestionRows.map((s) => {
      const avg = avgSpendingMap.get(s.categoryId);
      return {
        id: s.id,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        categoryColor: s.categoryColor,
        suggestedAmount: s.amount,
        currentAmount: activeAmountByCategory.get(s.categoryId) ?? null,
        avgMonthly: avg?.avgMonthly ?? 0,
        monthsOfData: avg?.monthCount ?? 0,
        generatedAt: s.generatedAt,
      };
    });

    const prefs = await getUserPreferences(userId);
    const regenerationDue =
      prefs.autoBudgetEnabled &&
      isRegenerationDue(
        prefs.lastAutoBudgetCheckAt,
        prefs.autoBudgetIntervalMonths,
      );

    return NextResponse.json({
      monthlyIncome: Math.round(scaledMonthlyIncome * 100) / 100,
      totalFixedCosts: Math.round(scaledTotalFixedCosts * 100) / 100,
      totalReserved: Math.round(totalReserved * 100) / 100,
      availableToAllocate: Math.round(availableToAllocate * 100) / 100,
      totalAllocated: Math.round(totalAllocated * 100) / 100,
      unallocated: Math.round(unallocated * 100) / 100,
      totalBudget: Math.round(totalBudget * 100) / 100,
      totalSpentThisMonth: Math.round(totalSpentThisMonth * 100) / 100,
      unbudgetedSpending,
      fixedCosts: fixedCostsWithAvg,
      allocations: allocationsWithAvg,
      reserved,
      suggestions,
      categoryAverages: allCategoryAvgs,
      automation: {
        enabled: prefs.autoBudgetEnabled,
        intervalMonths: prefs.autoBudgetIntervalMonths,
        lookbackMonths: prefs.autoBudgetLookbackMonths,
        lastCheckAt: prefs.lastAutoBudgetCheckAt,
        regenerationDue,
      },
      month: {
        from,
        to,
        label: rangeLabel(from, to),
      },
    });
  } catch (error) {
    console.error("Failed to fetch budget:", error);
    return NextResponse.json(
      { error: "Failed to fetch budget" },
      { status: 500 },
    );
  }
}

// POST /api/budgets — create a budget allocation for a category
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const { categoryId, amount } = body;

    if (!categoryId || amount === undefined) {
      return NextResponse.json(
        { error: "categoryId and amount are required" },
        { status: 400 },
      );
    }

    // Check if an active allocation already exists (suggestions are kept separate)
    const existing = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.categoryId, categoryId),
          eq(budgets.userId, userId),
          eq(budgets.status, "active"),
        ),
      );

    if (existing.length > 0) {
      // Update existing
      await db
        .update(budgets)
        .set({ amount, source: "manual" })
        .where(and(eq(budgets.id, existing[0].id), eq(budgets.userId, userId)));
      logDataEvent({
        userId,
        action: "budget_update",
        targetId: existing[0].id,
        targetType: "budget",
        details: { categoryId, amount },
      });
      return NextResponse.json({ success: true, id: existing[0].id });
    }

    const id = crypto.randomUUID();
    await db.insert(budgets).values({
      id,
      categoryId,
      amount,
      period: "monthly",
      isActive: true,
      status: "active",
      source: "manual",
      createdAt: new Date().toISOString(),
      userId,
    });

    logDataEvent({
      userId,
      action: "budget_create",
      targetId: id,
      targetType: "budget",
      details: { categoryId, amount },
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create/update allocation:", error);
    return NextResponse.json(
      { error: "Failed to create/update allocation" },
      { status: 500 },
    );
  }
}

// PUT /api/budgets — update a budget allocation
export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const { id, amount } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Budget ID is required" },
        { status: 400 },
      );
    }

    await db
      .update(budgets)
      .set({ amount })
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)));

    logDataEvent({
      userId,
      action: "budget_update",
      targetId: id,
      targetType: "budget",
      details: { amount },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update allocation:", error);
    return NextResponse.json(
      { error: "Failed to update allocation" },
      { status: 500 },
    );
  }
}

// DELETE /api/budgets — delete a budget allocation.
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Budget ID is required" },
        { status: 400 },
      );
    }

    await db
      .delete(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)));

    logDataEvent({
      userId,
      action: "budget_delete",
      targetId: id,
      targetType: "budget",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete allocation:", error);
    return NextResponse.json(
      { error: "Failed to delete allocation" },
      { status: 500 },
    );
  }
}
