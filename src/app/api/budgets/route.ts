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
import { withUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { logDataEvent } from "@/lib/audit";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { isRegenerationDue } from "@/lib/auto-budget";
import { getUserPreferences } from "@/lib/preferences";
import { toMonthly, getCurrentMonthRange } from "@/lib/month-money";
import { isFiniteNumber } from "@/lib/validation";
import { getStatsCutoff } from "@/lib/stat-reset";
import { accountScopeFilter, resolveBudgetPlan } from "@/lib/budget-plan";
import { financialYearOf } from "@/lib/financial-year";
import { touchAllLedgers } from "@/lib/budget-jobs";
import {
  getYearlyBudgetView,
  normaliseMonthIndex,
} from "@/lib/yearly-budget-view";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AVG_DAYS_PER_MONTH = 30.4375;

/** A whole number inside `[min, max]`, or null when absent or unusable. */
function parseIntParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function rangeLabel(from: string, to: string, intlLocale: string): string {
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
    return fromDate.toLocaleDateString(intlLocale, {
      month: "long",
      year: "numeric",
    });
  }

  const monthFmt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const fromStr = fromDate.toLocaleDateString(intlLocale, monthFmt);
  const toStr = toDate.toLocaleDateString(intlLocale, {
    ...monthFmt,
    year: "numeric",
  });
  return `${fromStr} – ${toStr}`;
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
  return withUser(async (userId) => {
    const { intlLocale } = await getI18n();
    const { searchParams } = new URL(request.url);
    const dateFromParam = searchParams.get("dateFrom");
    const dateToParam = searchParams.get("dateTo");
    // accountId may be a comma-separated list of account ids
    const accountIds =
      searchParams.get("accountId")?.split(",").filter(Boolean) ?? [];
    const budgetIdParam = searchParams.get("budgetId");
    const noScaleParam = searchParams.get("noScale");
    const noScale = noScaleParam === "1" || noScaleParam === "true";
    // Yearly plans only: which financial year to show, and which month inside
    // it. Both default to "now" and are clamped, so junk in the URL can't
    // produce a nonsense window.
    const yearParam = parseIntParam(searchParams.get("year"), 1970, 2200);
    const monthIndexParam = parseIntParam(searchParams.get("monthIndex"), 0, 11);

    const [prefs, plan] = await Promise.all([
      getUserPreferences(userId),
      resolveBudgetPlan(userId, budgetIdParam),
    ]);
    if (budgetIdParam && !plan) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    // Every spend-derived number in this endpoint respects one scope: an
    // explicit accountId param wins, otherwise the plan's accounts (main plan
    // when no budgetId was passed). A plan with zero accounts matches nothing.
    const scopeAccountIds =
      accountIds.length > 0 ? accountIds : plan ? plan.accountIds : undefined;
    const scopeFilter = accountScopeFilter(scopeAccountIds);

    // Use the requested range when both dates are present and well-formed;
    // otherwise default to the current financial month (honors the user's
    // financialMonthStartDay so the default matches the dashboard's window).
    const useRange =
      !!dateFromParam &&
      !!dateToParam &&
      ISO_DATE.test(dateFromParam) &&
      ISO_DATE.test(dateToParam) &&
      dateFromParam <= dateToParam;
    const { from, to } = useRange
      ? { from: dateFromParam!, to: dateToParam! }
      : getCurrentMonthRange(prefs.financialMonthStartDay);

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

    // 0. Get pot spending by category for current month.
    // Each pot's net spend is `-sum` of its expense/income member transactions,
    // floored at 0 — internal transfers don't count as spending.
    const potSpendingRows = await db
      .select({
        categoryId: transactionGroups.categoryId,
        potTotal: sql<number>`${potSpentAmount()}`,
      })
      .from(transactionGroups)
      .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
      .where(
        and(
          sql`${transactionGroups.categoryId} IS NOT NULL`,
          sql`${transactions.type} != 'internal_transfer'`,
          gte(transactions.date, from),
          lte(transactions.date, to),
          eq(transactions.userId, userId),
          ...(scopeFilter ? [scopeFilter] : []),
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

    // Recurring plans live on an account, so they follow the same scope as
    // spending — a Joint budget only counts salary/bills on joint accounts.
    const recurringScopeFilter =
      scopeAccountIds === undefined
        ? undefined
        : scopeAccountIds.length > 0
          ? inArray(recurringTransactions.accountId, scopeAccountIds)
          : sql`1=0`;

    // 1. Get recurring income (monthly equivalent)
    const recurringIncome = await db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.type, "income"),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.userId, userId),
          ...(recurringScopeFilter ? [recurringScopeFilter] : []),
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
          ...(recurringScopeFilter ? [recurringScopeFilter] : []),
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
    const allAllocations = await db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
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
          ...(plan ? [eq(budgets.budgetId, plan.id)] : []),
        ),
      );

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
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.status, "suggested"),
          ...(plan ? [eq(budgets.budgetId, plan.id)] : []),
        ),
      );

    // 4. Calculate actual spending per category for the current month in a
    // single grouped query (effective amounts, exclude grouped). We then look
    // up per allocation / fixed cost from the resulting map.
    const monthSpendRows = await db
      .select({
        categoryId: transactions.categoryId,
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          gte(transactions.date, from),
          lte(transactions.date, to),
          ...(scopeFilter ? [scopeFilter] : []),
        ),
      )
      .groupBy(transactions.categoryId);

    // Per-category aggregation for budget rows (only categorized rows match a
    // budget). Uncategorized expenses are tracked separately and rolled into
    // totalSpentThisMonth so it stays in sync with the Insights expense card.
    const monthSpendByCategory = new Map<string, number>();
    let uncategorizedSpend = 0;
    for (const row of monthSpendRows) {
      if (!row.categoryId) {
        uncategorizedSpend += row.total ?? 0;
        continue;
      }
      monthSpendByCategory.set(row.categoryId, row.total ?? 0);
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
    // A statistics reset restarts this average: months before the cutoff are
    // history, not evidence, so they neither add spend nor count as months.
    const statsCutoff = await getStatsCutoff(userId);
    const monthlySpendingByCategory = await db
      .select({
        categoryId: transactions.categoryId,
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        total: sql<number>`sum(${effectiveExpenseAmount()})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          // Exclude current month — only completed months
          sql`substr(${transactions.date}, 1, 7) < ${from.slice(0, 7)}`,
          ...(statsCutoff ? [gte(transactions.date, statsCutoff)] : []),
          eq(transactions.userId, userId),
          ...(scopeFilter ? [scopeFilter] : []),
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
    const availableToAllocate = monthlyIncome - totalFixedCosts;
    const unallocated = availableToAllocate - totalAllocated;

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
            .where(and(inArray(categories.id, unbudgetedCatIds), eq(categories.userId, userId)))
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

    // Total spending this month. Mirrors the Insights "Expenses" card so the
    // headline numbers agree: per-category transactions + uncategorized
    // transactions + pot spending (excluding internal transfers).
    let totalSpentThisMonth = uncategorizedSpend;
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

    const regenerationDue =
      prefs.autoBudgetEnabled &&
      isRegenerationDue(
        prefs.lastAutoBudgetCheckAt,
        prefs.autoBudgetIntervalMonths,
      );

    // A yearly plan gets an extra block: one annual envelope per category with
    // the carry-over chain resolved. The monthly figures above stay as they
    // are so every other consumer of this endpoint is unaffected.
    const yearly =
      plan?.period === "yearly"
        ? await getYearlyBudgetView(
            userId,
            plan,
            yearParam ?? financialYearOf(new Date(), prefs.financialMonthStartDay),
            normaliseMonthIndex(
              monthIndexParam,
              yearParam ?? financialYearOf(new Date(), prefs.financialMonthStartDay),
              prefs.financialMonthStartDay,
            ),
            prefs.financialMonthStartDay,
          )
        : null;

    return NextResponse.json({
      plan: plan
        ? { id: plan.id, name: plan.name, isMain: plan.isMain, period: plan.period }
        : null,
      yearly,
      monthlyIncome: Math.round(scaledMonthlyIncome * 100) / 100,
      totalFixedCosts: Math.round(scaledTotalFixedCosts * 100) / 100,
      availableToAllocate: Math.round(availableToAllocate * 100) / 100,
      totalAllocated: Math.round(totalAllocated * 100) / 100,
      unallocated: Math.round(unallocated * 100) / 100,
      totalBudget: Math.round(totalBudget * 100) / 100,
      totalSpentThisMonth: Math.round(totalSpentThisMonth * 100) / 100,
      unbudgetedSpending,
      fixedCosts: fixedCostsWithAvg,
      allocations: allocationsWithAvg,
      suggestions,
      categoryAverages: allCategoryAvgs,
      // Null unless a reset is in force. Every avgMonthly above counts from it.
      statsCutoff,
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
        label: rangeLabel(from, to, intlLocale),
      },
    });
  }, "Failed to fetch budget");
}

// POST /api/budgets — create a budget allocation for a category
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { categoryId, amount, budgetId } = body;

    if (!categoryId || amount === undefined) {
      return NextResponse.json(
        { error: "categoryId and amount are required" },
        { status: 400 },
      );
    }
    if (!isFiniteNumber(amount) || amount < 0) {
      return NextResponse.json(
        { error: "amount must be a non-negative finite number" },
        { status: 400 },
      );
    }
    if (budgetId !== undefined && typeof budgetId !== "string") {
      return NextResponse.json({ error: "budgetId must be a string" }, { status: 400 });
    }

    // The plan the allocation belongs to — main when the caller didn't say.
    const plan = await resolveBudgetPlan(userId, budgetId ?? null);
    if (budgetId && !plan) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    const [ownedCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!ownedCategory) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
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
          plan ? eq(budgets.budgetId, plan.id) : sql`${budgets.budgetId} IS NULL`,
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
      // A changed allocation resizes the annual envelope from here on.
      await touchAllLedgers(userId);
      return NextResponse.json({ success: true, id: existing[0].id });
    }

    const id = crypto.randomUUID();
    await db.insert(budgets).values({
      id,
      budgetId: plan?.id ?? null,
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

    // A category added mid-year gets a prorated envelope — computed in the
    // background so this response doesn't wait for it.
    await touchAllLedgers(userId);

    return NextResponse.json({ success: true, id }, { status: 201 });
  }, "Failed to create/update allocation");
}

// PUT /api/budgets — update a budget allocation
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, amount } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Budget ID is required" },
        { status: 400 },
      );
    }
    if (!isFiniteNumber(amount) || amount < 0) {
      return NextResponse.json(
        { error: "amount must be a non-negative finite number" },
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

    // Closed months keep their old target; the new one applies from now on.
    await touchAllLedgers(userId);

    return NextResponse.json({ success: true });
  }, "Failed to update allocation");
}

// DELETE /api/budgets — delete a budget allocation.
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
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

    await touchAllLedgers(userId);

    return NextResponse.json({ success: true });
  }, "Failed to delete allocation");
}
