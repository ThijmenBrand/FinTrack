import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import {
  budgets,
  budgetSubLines,
  categories,
  transactions,
  recurringTransactions,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import type { BudgetSubLine, IncomeLine } from "@/types/api";
import { withUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { logDataEvent } from "@/lib/audit";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { excludeSplitParents } from "@/lib/split-sql";
import { isRegenerationDue } from "@/lib/auto-budget";
import { getUserPreferences } from "@/lib/preferences";
import { toMonthly, getCurrentMonthRange } from "@/lib/month-money";
import { isFiniteNumber, isIsoDate, validateName } from "@/lib/validation";
import { requireAccountAccess } from "@/lib/account-access";
import type { MessageKey, Vars } from "@/lib/i18n/translate";
import {
  MAX_SUB_LINE_DEPTH,
  MAX_SUB_LINES_PER_ALLOCATION,
  SUB_LINE_ERROR,
  SUB_LINE_ERROR_MESSAGE,
  countSubLines,
  resyncUpwards,
} from "@/lib/budget-sub-lines";
import { getStatsCutoff } from "@/lib/stat-reset";
import { accountScopeFilter, resolveBudgetPlan, resolveBudgetRowAccess } from "@/lib/budget-plan";
import {
  financialYearOf,
  getFinancialYearRange,
  MONTHS_PER_YEAR,
} from "@/lib/financial-year";
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

interface CategoryGroup {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  monthlyAmount: number;
  items: { description: string; monthlyAmount: number }[];
}

/**
 * Recurring plans folded into one row per category, in monthly-equivalent
 * money. Plans with no category collapse into a single "uncategorized" row.
 * Shared by fixed costs (expenses) and income lines so both sides group,
 * name and colour identically.
 */
function groupRecurringByCategory(
  rows: {
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    amount: number;
    frequency: string;
    description: string;
  }[],
): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const r of rows) {
    const catId = r.categoryId || "uncategorized";
    const monthly = toMonthly(r.amount, r.frequency);
    const existing = map.get(catId);
    if (existing) {
      existing.monthlyAmount += monthly;
      existing.items.push({
        description: r.description,
        monthlyAmount: monthly,
      });
    } else {
      map.set(catId, {
        categoryId: catId,
        categoryName: r.categoryName || "Uncategorized",
        categoryColor: r.categoryColor || "#94a3b8",
        monthlyAmount: monthly,
        items: [{ description: r.description, monthlyAmount: monthly }],
      });
    }
  }
  return Array.from(map.values());
}

interface CategoryAverage {
  total: number;
  monthCount: number;
  avgMonthly: number;
}

/**
 * Per-category mean over the completed months the rows cover. Rows are
 * `(categoryId, month, total)` buckets; a category's month count is the number
 * of distinct months it actually appears in, so a category that only existed
 * for two of six months averages over two.
 */
function foldMonthlyAverages(
  rows: { categoryId: string | null; month: string; total: number | null }[],
): Map<string, CategoryAverage> {
  const map = new Map<string, CategoryAverage>();
  const monthsSeen = new Map<string, Set<string>>();

  for (const row of rows) {
    const catId = row.categoryId || "uncategorized";
    if (!monthsSeen.has(catId)) monthsSeen.set(catId, new Set());
    monthsSeen.get(catId)!.add(row.month);

    const existing = map.get(catId);
    if (existing) existing.total += row.total ?? 0;
    else map.set(catId, { total: row.total ?? 0, monthCount: 0, avgMonthly: 0 });
  }

  for (const [catId, data] of map) {
    data.monthCount = monthsSeen.get(catId)?.size || 1;
    data.avgMonthly = Math.round((data.total / data.monthCount) * 100) / 100;
  }
  return map;
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
      return apiError("api.budgetNotFound", 404);
    }
    // A shared plan reads entirely as its OWNER — allocations, categories,
    // spending and the owner's financial-month window — so member and owner
    // see identical numbers. Own plans: dataUserId === userId.
    const dataUserId = plan?.ownerId ?? userId;
    const startDay =
      plan && plan.ownerId !== userId
        ? (await getUserPreferences(plan.ownerId)).financialMonthStartDay
        : prefs.financialMonthStartDay;

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
      : getCurrentMonthRange(startDay);

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
          excludeSplitParents(),
          gte(transactions.date, from),
          lte(transactions.date, to),
          eq(transactions.userId, dataUserId),
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

    // 1. Get recurring income (monthly equivalent), grouped by category the
    // same way fixed costs are — one income line per category, plus the
    // headline total.
    const recurringIncome = await db
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
          eq(recurringTransactions.type, "income"),
          eq(recurringTransactions.isActive, true),
          eq(recurringTransactions.userId, dataUserId),
          ...(recurringScopeFilter ? [recurringScopeFilter] : []),
        ),
      );

    const monthlyIncome = recurringIncome.reduce(
      (sum, r) => sum + toMonthly(r.amount, r.frequency),
      0,
    );

    const incomeGroups = groupRecurringByCategory(recurringIncome);

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
          eq(recurringTransactions.userId, dataUserId),
          ...(recurringScopeFilter ? [recurringScopeFilter] : []),
        ),
      );

    // Group recurring expenses by category
    const fixedCosts = groupRecurringByCategory(recurringExpenses);
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
          eq(budgets.userId, dataUserId),
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
          eq(budgets.userId, dataUserId),
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
          eq(transactions.userId, dataUserId),
          eq(transactions.type, "expense"),
          sql`${transactions.groupId} IS NULL`,
          excludeSplitParents(),
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

    // 4b. Actual income received per category over the same window and account
    // scope. `type = 'income'` already excludes reimbursements and internal
    // transfers (both are their own transaction types), and grouped rows are a
    // pot's internal accounting rather than new money.
    // There is no `effectiveIncomeAmount()` analogue to `effectiveExpenseAmount()`
    // — reimbursement links only ever net against expenses — so income uses the
    // plain stored amount, same as getAnnualIncome does.
    // The category is joined here (not just grouped by id) so income that
    // arrived in a category with no recurring plan behind it can still be
    // named — see the unplanned lines appended below.
    const monthIncomeRows = await db
      .select({
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.userId, dataUserId),
          eq(transactions.type, "income"),
          sql`${transactions.groupId} IS NULL`,
          excludeSplitParents(),
          gte(transactions.date, from),
          lte(transactions.date, to),
          ...(scopeFilter ? [scopeFilter] : []),
        ),
      )
      .groupBy(transactions.categoryId, categories.name, categories.color);

    // Keyed like the income lines themselves: null category → "uncategorized".
    const receivedByCategory = new Map<string, number>();
    const incomeCategoryMeta = new Map<string, { name: string; color: string }>();
    for (const row of monthIncomeRows) {
      const catId = row.categoryId || "uncategorized";
      receivedByCategory.set(
        catId,
        (receivedByCategory.get(catId) ?? 0) + (Number(row.total) || 0),
      );
      incomeCategoryMeta.set(catId, {
        name: row.categoryName || "Uncategorized",
        color: row.categoryColor || "#94a3b8",
      });
    }

    // 3c. Sub-lines: nested breakdown under each allocation. Scaled by the
    // same monthsScale factor as the allocation's own amount above, so a
    // sub-line and its parent stay comparable in the same response.
    const allAllocationIds = allAllocations.map((a) => a.id);
    const subLineRows =
      allAllocationIds.length > 0
        ? await db
            .select()
            .from(budgetSubLines)
            .where(
              and(
                inArray(budgetSubLines.allocationId, allAllocationIds),
                eq(budgetSubLines.userId, dataUserId),
              ),
            )
            .orderBy(budgetSubLines.createdAt)
        : [];
    const subLineRowsByAllocation = new Map<string, typeof subLineRows>();
    for (const row of subLineRows) {
      const list = subLineRowsByAllocation.get(row.allocationId);
      if (list) list.push(row);
      else subLineRowsByAllocation.set(row.allocationId, [row]);
    }

    // The plans linked sub-lines stand for, in one query for the whole page —
    // a per-sub-line lookup would scale with the tree, not with the response.
    const linkedRecurringIds = [
      ...new Set(
        subLineRows
          .map((r) => r.recurringTransactionId)
          .filter((id): id is string => !!id),
      ),
    ];
    const linkedRecurringRows =
      linkedRecurringIds.length > 0
        ? await db
            .select({
              id: recurringTransactions.id,
              amount: recurringTransactions.amount,
              frequency: recurringTransactions.frequency,
              dayOfWeek: recurringTransactions.dayOfWeek,
              dayOfMonth: recurringTransactions.dayOfMonth,
              monthOfYear: recurringTransactions.monthOfYear,
              startDate: recurringTransactions.startDate,
              isActive: recurringTransactions.isActive,
            })
            .from(recurringTransactions)
            .where(
              and(
                inArray(recurringTransactions.id, linkedRecurringIds),
                eq(recurringTransactions.userId, dataUserId),
              ),
            )
        : [];
    const linkedRecurringById = new Map(
      linkedRecurringRows.map((r) => [r.id, r]),
    );

    function buildSubLineTree(allocationId: string): BudgetSubLine[] {
      const rows = subLineRowsByAllocation.get(allocationId) ?? [];
      const nodes = new Map<string, BudgetSubLine>();
      for (const r of rows) {
        // The recurring row keeps its per-occurrence amount as stored (signed);
        // only the sub-line's monthly figure is scaled to the window.
        const linked = r.recurringTransactionId
          ? linkedRecurringById.get(r.recurringTransactionId)
          : undefined;
        nodes.set(r.id, {
          id: r.id,
          parentId: r.parentId,
          name: r.name,
          amount: r.amount * monthsScale,
          children: [],
          ...(linked ? { recurring: linked } : {}),
        });
      }
      const roots: BudgetSubLine[] = [];
      for (const r of rows) {
        const node = nodes.get(r.id)!;
        if (r.parentId && nodes.has(r.parentId)) {
          nodes.get(r.parentId)!.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    }

    const allocationsWithSpending = allAllocations.map((alloc) => {
      const scaledAmount = alloc.amount * monthsScale;
      const txSpent = monthSpendByCategory.get(alloc.categoryId) || 0;
      const potSpent = potSpendingByCategory.get(alloc.categoryId) || 0;
      const spent = txSpent + potSpent;
      // Spending against a cap of nothing is over budget, not "ok".
      const percentage =
        scaledAmount > 0 ? (spent / scaledAmount) * 100 : spent > 0 ? 100 : 0;
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
        subLines: buildSubLineTree(alloc.id),
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
    const statsCutoff = await getStatsCutoff(dataUserId);
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
          excludeSplitParents(),
          // Exclude current month — only completed months
          sql`substr(${transactions.date}, 1, 7) < ${from.slice(0, 7)}`,
          ...(statsCutoff ? [gte(transactions.date, statsCutoff)] : []),
          eq(transactions.userId, dataUserId),
          ...(scopeFilter ? [scopeFilter] : []),
        ),
      )
      .groupBy(
        transactions.categoryId,
        sql`substr(${transactions.date}, 1, 7)`,
      );

    // Build map: categoryId -> { total, monthCount, avgMonthly }
    const avgSpendingMap = foldMonthlyAverages(monthlySpendingByCategory);

    // 5b. Same average, income side: mean actually received per completed
    // month, honouring the same stats cutoff. Deliberately NOT avgSpendingMap,
    // which is expense-only.
    const monthlyIncomeByCategory = await db
      .select({
        categoryId: transactions.categoryId,
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "income"),
          sql`${transactions.groupId} IS NULL`,
          excludeSplitParents(),
          sql`substr(${transactions.date}, 1, 7) < ${from.slice(0, 7)}`,
          ...(statsCutoff ? [gte(transactions.date, statsCutoff)] : []),
          eq(transactions.userId, dataUserId),
          ...(scopeFilter ? [scopeFilter] : []),
        ),
      )
      .groupBy(transactions.categoryId, sql`substr(${transactions.date}, 1, 7)`);

    const avgIncomeMap = foldMonthlyAverages(monthlyIncomeByCategory);

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

    // 5c. Income lines: expected (recurring plans) vs received (real money in).
    // `expected` is scaled by monthsScale exactly like a fixed cost, so both
    // sides of the budget stay in the same unit for the requested window.
    // `received` is NOT scaled — it is money that actually landed inside
    // [from, to], already denominated in that window; multiplying it would
    // invent income that never arrived.
    const year = yearParam ?? financialYearOf(new Date(), startDay);
    const isYearly = plan?.period === "yearly";

    // Year scope (yearly plans only). getAnnualIncome() answers a different
    // question — one blended actual+projected total for the whole plan — so it
    // can't produce per-category expected/received; only its financial-year
    // window is reused here.
    const yearReceivedByCategory = new Map<string, number>();
    if (isYearly) {
      const { from: yearFrom, to: yearTo } = getFinancialYearRange(
        year,
        startDay,
      );
      const rows = await db
        .select({
          categoryId: transactions.categoryId,
          total: sql<number>`sum(${transactions.amount})`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, dataUserId),
            eq(transactions.type, "income"),
            sql`${transactions.groupId} IS NULL`,
            excludeSplitParents(),
            gte(transactions.date, yearFrom),
            lte(transactions.date, yearTo),
            ...(scopeFilter ? [scopeFilter] : []),
          ),
        )
        .groupBy(transactions.categoryId);
      for (const row of rows) {
        const catId = row.categoryId || "uncategorized";
        yearReceivedByCategory.set(
          catId,
          (yearReceivedByCategory.get(catId) ?? 0) + (Number(row.total) || 0),
        );
      }
    }

    const incomeLines: IncomeLine[] = incomeGroups.map((g) => {
      const avg = avgIncomeMap.get(g.categoryId);
      return {
        categoryId: g.categoryId,
        categoryName: g.categoryName,
        categoryColor: g.categoryColor,
        expected: Math.round(g.monthlyAmount * monthsScale * 100) / 100,
        received: Math.round((receivedByCategory.get(g.categoryId) ?? 0) * 100) / 100,
        avgMonthly: avg?.avgMonthly ?? 0,
        avgMonths: avg?.monthCount ?? 0,
        items: g.items,
        ...(isYearly
          ? {
              year: {
                expected:
                  Math.round(g.monthlyAmount * MONTHS_PER_YEAR * 100) / 100,
                received:
                  Math.round(
                    (yearReceivedByCategory.get(g.categoryId) ?? 0) * 100,
                  ) / 100,
              },
            }
          : {}),
      };
    });

    // Income that landed in a category no recurring plan covers: a one-off
    // bonus, a refund booked as income, a side gig with no plan behind it. It
    // expects nothing, so it can't be "short" — but leaving it out entirely
    // meant the income side of the budget silently disagreed with the
    // transactions page. The expense side has `unbudgetedSpending` for exactly
    // this; these are its counterpart, and sort to the bottom on expected = 0.
    const plannedIncomeIds = new Set(incomeGroups.map((g) => g.categoryId));
    for (const [catId, received] of receivedByCategory) {
      if (plannedIncomeIds.has(catId) || Math.abs(received) < 0.005) continue;
      const avg = avgIncomeMap.get(catId);
      const meta = incomeCategoryMeta.get(catId);
      incomeLines.push({
        categoryId: catId,
        categoryName: meta?.name ?? "Uncategorized",
        categoryColor: meta?.color ?? "#94a3b8",
        expected: 0,
        received: Math.round(received * 100) / 100,
        avgMonthly: avg?.avgMonthly ?? 0,
        avgMonths: avg?.monthCount ?? 0,
        items: [],
        ...(isYearly
          ? {
              year: {
                expected: 0,
                received:
                  Math.round((yearReceivedByCategory.get(catId) ?? 0) * 100) / 100,
              },
            }
          : {}),
      });
    }

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

    // Bills whose category has no allocation of its own. A category that has
    // both gets ONE row — the allocation's, with its plans nested under it (see
    // the Budgets page's `ownFixed` and the editor's `lockedExpenses`, which
    // both already count it this way) — and `budgets.amount` already contains
    // those plans, because POST /api/budgets rolls a sub-line tree up into it.
    // Adding every plan on top again double-counted the bill in every total
    // below: a €1.000 rent with a €1.000 allocation read as €2.000 budgeted.
    const allocatedCategoryIds = new Set(allAllocations.map((a) => a.categoryId));
    const ownFixedCosts = fixedCosts.reduce(
      (s, fc) => (allocatedCategoryIds.has(fc.categoryId) ? s : s + fc.monthlyAmount),
      0,
    );
    // One unit for all three: with a multi-month range the income and the
    // allocations were scaled but the headroom between them was not, so
    // `unallocated` mixed a month of income with a quarter of allocations.
    const availableToAllocate = scaledMonthlyIncome - ownFixedCosts * monthsScale;
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
            .where(and(inArray(categories.id, unbudgetedCatIds), eq(categories.userId, dataUserId)))
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
      // Money with no category at all is the most unbudgeted money there is.
      // It counts in `totalSpentThisMonth`, so leaving it out of every row left
      // it in the headline and in no list — and the insights bar, which stacks
      // these rows up to that headline, drew an unexplained gap for it.
      .concat(
        uncategorizedSpend > 0
          ? [
              {
                categoryId: "uncategorized",
                categoryName: "Uncategorized",
                categoryColor: "#94a3b8",
                spent: Math.round(uncategorizedSpend * 100) / 100,
              },
            ]
          : [],
      )
      .sort((a, b) => b.spent - a.spent);

    // Total spending this month. Mirrors the Insights "Expenses" card so the
    // headline numbers agree: per-category transactions + uncategorized
    // transactions + pot spending (excluding internal transfers).
    let totalSpentThisMonth = uncategorizedSpend;
    for (const amount of monthSpendByCategory.values())
      totalSpentThisMonth += amount;
    for (const amount of potSpendingByCategory.values())
      totalSpentThisMonth += amount;
    // Same rule as `availableToAllocate`: the bills a category's own allocation
    // already covers are not a second budget line.
    const totalBudget = ownFixedCosts * monthsScale + totalAllocated;

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
      isYearly && plan
        ? await getYearlyBudgetView(
            dataUserId,
            plan,
            year,
            normaliseMonthIndex(monthIndexParam, year, startDay),
            startDay,
            new Date(),
            plan.role === "owner",
          )
        : null;

    return NextResponse.json({
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            isMain: plan.isMain,
            period: plan.period,
            role: plan.role,
            ownerName: plan.ownerName,
          }
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
      incomeLines,
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

const FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

/** The create-new-plan half of a ChildInput, once validated. */
interface RecurringInput {
  accountId: string;
  amount: number;
  frequency: Frequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
}

/** One node of the submitted tree, after validation. */
interface PreparedChild {
  name: string;
  amount: number;
  children: PreparedChild[];
  adoptRecurringId: string | null;
  recurring: RecurringInput | null;
}

/**
 * Two flavours of rejection: `rule` is a SUB_LINE_ERROR code the client
 * translates itself, `key` an ordinary translatable message.
 */
type ParseResult =
  | { ok: true; nodes: PreparedChild[] }
  | { ok: false; rule?: string; key?: MessageKey; vars?: Vars };

/** An absent optional integer, its value, or `false` when it is present but junk. */
function optionalInt(v: unknown, min: number, max: number): number | null | false {
  if (v === undefined || v === null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : false;
}

/** Same rules POST /api/recurring applies; null when anything is off. */
function parseRecurring(raw: unknown): RecurringInput | null {
  const r = raw as Record<string, unknown>;
  if (typeof r?.accountId !== "string" || !r.accountId) return null;
  if (!isFiniteNumber(r.amount) || r.amount <= 0) return null;
  if (!FREQUENCIES.includes(r.frequency as Frequency)) return null;
  if (!isIsoDate(r.startDate)) return null;
  const dayOfWeek = optionalInt(r.dayOfWeek, 0, 6);
  const dayOfMonth = optionalInt(r.dayOfMonth, 1, 31);
  const monthOfYear = optionalInt(r.monthOfYear, 1, 12);
  if (dayOfWeek === false || dayOfMonth === false || monthOfYear === false) return null;
  return {
    accountId: r.accountId,
    amount: r.amount,
    frequency: r.frequency as Frequency,
    dayOfWeek,
    dayOfMonth,
    monthOfYear,
    startDate: r.startDate as string,
  };
}

/**
 * Validate the WHOLE submitted tree before anything is written — depth, count,
 * every name and every amount — so a tree that breaks a cap is refused with
 * nothing inserted.
 */
function parseChildren(
  input: unknown,
  depth: number,
  counter: { n: number },
): ParseResult {
  if (!Array.isArray(input)) return { ok: false, key: "api.invalidBody" };
  const nodes: PreparedChild[] = [];
  for (const item of input) {
    if (++counter.n > MAX_SUB_LINES_PER_ALLOCATION) {
      return { ok: false, rule: SUB_LINE_ERROR.tooMany };
    }
    const raw = (item ?? {}) as Record<string, unknown>;
    const name = validateName(raw.name);
    if (!name.ok) return { ok: false, key: name.error, vars: name.vars };
    if (!isFiniteNumber(raw.amount) || raw.amount <= 0) {
      return { ok: false, key: "api.invalidAmount" };
    }

    const adopt = raw.adoptRecurringId;
    if (adopt !== undefined && adopt !== null && typeof adopt !== "string") {
      return { ok: false, key: "api.invalidBody" };
    }
    let recurring: RecurringInput | null = null;
    if (raw.recurring !== undefined && raw.recurring !== null) {
      if (adopt) return { ok: false, key: "api.invalidBody" };
      recurring = parseRecurring(raw.recurring);
      if (!recurring) return { ok: false, key: "api.invalidBody" };
    }

    const rawChildren = raw.children;
    let children: PreparedChild[] = [];
    if (Array.isArray(rawChildren) && rawChildren.length > 0) {
      // A container's amount is its children's sum, so it cannot also be a
      // recurring plan — that would be two sources for one number.
      if (adopt || recurring) return { ok: false, key: "api.invalidBody" };
      if (depth + 1 > MAX_SUB_LINE_DEPTH) return { ok: false, rule: SUB_LINE_ERROR.tooDeep };
      const nested = parseChildren(rawChildren, depth + 1, counter);
      if (!nested.ok) return nested;
      children = nested.nodes;
    } else if (rawChildren !== undefined && rawChildren !== null && !Array.isArray(rawChildren)) {
      return { ok: false, key: "api.invalidBody" };
    }

    nodes.push({
      name: name.value,
      amount: raw.amount,
      children,
      adoptRecurringId: (adopt as string | undefined) ?? null,
      recurring,
    });
  }
  return { ok: true, nodes };
}

/**
 * A recurring plan can back at most one sub-line. No translatable key names
 * this case yet, so it travels as a machine code the client can map.
 */
function alreadyLinked() {
  return NextResponse.json(
    { error: "That recurring plan is already linked to a sub-line", code: "recurring_already_linked" },
    { status: 409 },
  );
}

/** Depth-first walk over a prepared tree, parents before their children. */
function walkChildren(nodes: PreparedChild[]): PreparedChild[] {
  return nodes.flatMap((n) => [n, ...walkChildren(n.children)]);
}

// POST /api/budgets — create a budget allocation for a category, optionally
// with its whole sub-line tree (and the recurring plans some lines stand for)
// in the same transaction.
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

    // The whole tree is checked here, before a single row is written.
    const parsed: ParseResult =
      body.children === undefined || body.children === null
        ? { ok: true, nodes: [] }
        : parseChildren(body.children, 1, { n: 0 });
    if (!parsed.ok) {
      if (parsed.rule) {
        return NextResponse.json(
          { error: SUB_LINE_ERROR_MESSAGE[parsed.rule], code: parsed.rule },
          { status: 400 },
        );
      }
      return apiError(parsed.key!, 400, parsed.vars);
    }
    const tree = parsed.nodes;
    const allNodes = walkChildren(tree);

    // The plan the allocation belongs to — main when the caller didn't say.
    const plan = await resolveBudgetPlan(userId, budgetId ?? null);
    if (budgetId && !plan) {
      return apiError("api.budgetNotFound", 404);
    }
    // Viewers on a shared plan are read-only; editors may allocate same as
    // the owner.
    if (plan && plan.role === "viewer") {
      return apiError("api.readOnly", 403);
    }
    // Allocations are plan-owned data: every row (and the category it
    // references) lives in the OWNER's space — own plans: dataUserId === userId.
    const dataUserId = plan?.ownerId ?? userId;

    const [ownedCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.userId, dataUserId)))
      .limit(1);
    if (!ownedCategory) {
      return apiError("api.categoryNotFound", 404);
    }

    // Plans a line adopts: the owner's own, an expense, and on an account this
    // plan scopes — the same scope GET applies to recurring rows.
    const adoptIds = allNodes
      .map((n) => n.adoptRecurringId)
      .filter((v): v is string => !!v);
    const adoptedById = new Map<string, { amount: number; frequency: string }>();
    if (adoptIds.length > 0) {
      if (new Set(adoptIds).size !== adoptIds.length) return alreadyLinked();
      const rows = await db
        .select({
          id: recurringTransactions.id,
          amount: recurringTransactions.amount,
          frequency: recurringTransactions.frequency,
        })
        .from(recurringTransactions)
        .where(
          and(
            inArray(recurringTransactions.id, adoptIds),
            eq(recurringTransactions.userId, dataUserId),
            eq(recurringTransactions.type, "expense"),
            ...(plan
              ? [
                  plan.accountIds.length > 0
                    ? inArray(recurringTransactions.accountId, plan.accountIds)
                    : sql`1=0`,
                ]
              : []),
          ),
        );
      if (rows.length !== adoptIds.length) {
        return apiError("api.recurringNotFound", 404);
      }
      for (const r of rows) adoptedById.set(r.id, r);
    }

    // A created plan lands in the same owner space as the allocation, so the
    // account it hangs off has to be writable by the caller AND owned there —
    // same rule the import endpoint applies.
    for (const accountId of new Set(
      allNodes.filter((n) => n.recurring).map((n) => n.recurring!.accountId),
    )) {
      const access = await requireAccountAccess(userId, accountId, "write");
      if (access.account.userId !== dataUserId) {
        return apiError("api.accountNotFound", 404);
      }
    }

    // Derived amounts, resolved before the write so the rows go in already
    // rolled up: a container is its children's sum, a linked line is its plan
    // expressed monthly, and only a plain leaf keeps what was submitted.
    const amountOf = new Map<PreparedChild, number>();
    const resolveAmount = (node: PreparedChild): number => {
      const adopted = node.adoptRecurringId
        ? adoptedById.get(node.adoptRecurringId)
        : undefined;
      const value =
        node.children.length > 0
          ? node.children.reduce((sum, c) => sum + resolveAmount(c), 0)
          : node.recurring
            ? toMonthly(node.recurring.amount, node.recurring.frequency)
            : adopted
              ? toMonthly(adopted.amount, adopted.frequency)
              : node.amount;
      amountOf.set(node, value);
      return value;
    };
    tree.forEach(resolveAmount);

    const now = new Date().toISOString();
    async function insertTree(
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
      nodes: PreparedChild[],
      allocationId: string,
      parentId: string | null,
    ): Promise<void> {
      for (const node of nodes) {
        const id = crypto.randomUUID();
        let recurringId = node.adoptRecurringId;
        if (node.recurring) {
          recurringId = crypto.randomUUID();
          await tx.insert(recurringTransactions).values({
            id: recurringId,
            userId: dataUserId,
            accountId: node.recurring.accountId,
            description: node.name,
            // Expenses are stored negative — same convention POST /api/recurring
            // writes; a positive expense row would corrupt every total.
            amount: -Math.abs(node.recurring.amount),
            type: "expense",
            categoryId,
            frequency: node.recurring.frequency,
            dayOfWeek: node.recurring.dayOfWeek,
            dayOfMonth: node.recurring.dayOfMonth,
            monthOfYear: node.recurring.monthOfYear,
            startDate: node.recurring.startDate,
            endDate: null,
            isActive: true,
            createdAt: now,
          });
        }
        await tx.insert(budgetSubLines).values({
          id,
          userId: dataUserId,
          allocationId,
          parentId,
          name: node.name,
          amount: amountOf.get(node)!,
          recurringTransactionId: recurringId,
          createdAt: now,
        });
        await insertTree(tx, node.children, allocationId, id);
      }
    }

    // Check if an active allocation already exists (suggestions are kept separate)
    const existing = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.categoryId, categoryId),
          eq(budgets.userId, dataUserId),
          eq(budgets.status, "active"),
          plan ? eq(budgets.budgetId, plan.id) : sql`${budgets.budgetId} IS NULL`,
        ),
      );

    const auditDetails = {
      categoryId,
      amount,
      // The count, not the tree: an audit row is a trail, not a copy of the payload.
      ...(allNodes.length > 0 ? { children: allNodes.length } : {}),
      ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}),
    };

    const existingId: string | null = existing.length > 0 ? existing[0].id : null;
    const allocationId = existingId ?? crypto.randomUUID();

    // Allocation, every descendant and every plan they create or adopt land in
    // one transaction — a tree that fails halfway must leave nothing behind.
    // Every check runs before the first insert, so an early return commits an
    // empty transaction rather than a partial one.
    const outcome = await db.transaction(async (tx) => {
      if (tree.length > 0) {
        const alreadyThere = await countSubLines(tx, allocationId, dataUserId);
        if (alreadyThere + allNodes.length > MAX_SUB_LINES_PER_ALLOCATION) {
          return SUB_LINE_ERROR.tooMany;
        }
        if (adoptIds.length > 0) {
          const linked = await tx
            .select({ id: budgetSubLines.id })
            .from(budgetSubLines)
            .where(
              and(
                inArray(budgetSubLines.recurringTransactionId, adoptIds),
                eq(budgetSubLines.userId, dataUserId),
              ),
            )
            .limit(1);
          if (linked.length > 0) return "already_linked";
        }
      }

      if (existingId) {
        await tx
          .update(budgets)
          .set({ amount, source: "manual" })
          .where(and(eq(budgets.id, existingId), eq(budgets.userId, dataUserId)));
      } else {
        await tx.insert(budgets).values({
          id: allocationId,
          budgetId: plan?.id ?? null,
          categoryId,
          amount,
          period: "monthly",
          isActive: true,
          status: "active",
          source: "manual",
          createdAt: now,
          userId: dataUserId,
        });
      }

      if (tree.length > 0) {
        await insertTree(tx, tree, allocationId, null);
        // The allocation now adds up from its roots — including any that were
        // already there when children were submitted for an existing category.
        await resyncUpwards(tx, allocationId, dataUserId, null);
      }
      return null;
    });

    if (outcome === "already_linked") return alreadyLinked();
    if (outcome === SUB_LINE_ERROR.tooMany) {
      return NextResponse.json(
        { error: SUB_LINE_ERROR_MESSAGE[outcome], code: outcome },
        { status: 400 },
      );
    }

    logDataEvent({
      userId,
      action: existingId ? "budget_update" : "budget_create",
      targetId: allocationId,
      targetType: "budget",
      details: auditDetails,
    });

    return NextResponse.json(
      { success: true, id: allocationId },
      { status: existingId ? 200 : 201 },
    );
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

    const [existing] = await db
      .select({ userId: budgets.userId, budgetId: budgets.budgetId })
      .from(budgets)
      .where(eq(budgets.id, id))
      .limit(1);
    if (!existing) {
      return apiError("api.budgetNotFound", 404);
    }
    const access = await resolveBudgetRowAccess(userId, existing);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 403 ? "Read-only access" : "Budget not found" },
        { status: access.status },
      );
    }
    const dataUserId = access.dataUserId;

    await db
      .update(budgets)
      .set({ amount })
      .where(and(eq(budgets.id, id), eq(budgets.userId, dataUserId)));

    logDataEvent({
      userId,
      action: "budget_update",
      targetId: id,
      targetType: "budget",
      details: { amount, ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}) },
    });

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

    const [existing] = await db
      .select({ userId: budgets.userId, budgetId: budgets.budgetId })
      .from(budgets)
      .where(eq(budgets.id, id))
      .limit(1);
    if (!existing) {
      return apiError("api.budgetNotFound", 404);
    }
    const access = await resolveBudgetRowAccess(userId, existing);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 403 ? "Read-only access" : "Budget not found" },
        { status: access.status },
      );
    }
    const dataUserId = access.dataUserId;

    // Explicit cleanup instead of relying on FK cascades — libsql connections
    // don't guarantee foreign_keys=ON.
    await db.transaction(async (tx) => {
      await tx
        .delete(budgetSubLines)
        .where(
          and(eq(budgetSubLines.allocationId, id), eq(budgetSubLines.userId, dataUserId)),
        );
      await tx
        .delete(budgets)
        .where(and(eq(budgets.id, id), eq(budgets.userId, dataUserId)));
    });

    logDataEvent({
      userId,
      action: "budget_delete",
      targetId: id,
      targetType: "budget",
      details: dataUserId !== userId ? { accountOwnerId: dataUserId } : undefined,
    });

    return NextResponse.json({ success: true });
  }, "Failed to delete allocation");
}
