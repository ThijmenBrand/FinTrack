/**
 * The dashboard's budget card, computed: one plan's allocations against this
 * financial month's spending. Lives outside the app tree (and away from
 * request-bound i18n) so the notification worker can ask the same question the
 * dashboard answers — "is Groceries over?" must never get two answers.
 */
import { cache } from "react";
import { db } from "@/db";
import {
  accounts,
  transactions,
  budgets,
  categories,
  recurringTransactions,
  transactionGroups,
} from "@/db/schema";
import { eq, and, gte, lte, sql, inArray } from "drizzle-orm";
import {
  accountScopeFilter,
  effectiveStartDay,
  resolveBudgetPlan,
  resolveMainPlan,
  type ResolvedBudgetPlan,
} from "@/lib/budget-plan";
import { visibleAccounts } from "@/lib/account-access";
import { currentFinancialSlot } from "@/lib/financial-year";
import { buildLedgerYear } from "@/lib/budget-ledger-db";
import { toMonthly } from "@/lib/month-money";
import { getFinancialMonthRange, getPeriodProgress } from "@/lib/financial-month";
import { toIsoDate } from "@/lib/utils";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import { excludeSplitParents } from "@/lib/split-sql";

// ─── Helpers ────────────────────────────────────────────────────────

function getPeriodRange(
  period: string,
  startDay: number = 1,
): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  switch (period) {
    case "daily": {
      const iso = toIsoDate(new Date(y, m, d));
      return { from: iso, to: iso };
    }
    case "weekly": {
      const off = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(y, m, d + off);
      const sun = new Date(mon);
      sun.setDate(sun.getDate() + 6);
      return { from: toIsoDate(mon), to: toIsoDate(sun) };
    }
    case "monthly": {
      return getFinancialMonthRange(now, startDay);
    }
    case "yearly":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default:
      return { from: "2000-01-01", to: "2099-12-31" };
  }
}

export function getDateRanges(startDay: number = 1) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  // Fraction of the financial month elapsed, including today.
  const {
    from: monthStart,
    to: monthEnd,
    progress: monthProgress,
  } = getPeriodProgress(now, startDay);

  const weekOff = dow === 0 ? -6 : 1 - dow;
  const weekStart = toIsoDate(new Date(y, m, d + weekOff));
  const weekEnd = toIsoDate(new Date(y, m, d + weekOff + 6));

  const lastWeekStart = toIsoDate(new Date(y, m, d + weekOff - 7));
  const lastWeekEnd = toIsoDate(new Date(y, m, d + weekOff - 1));

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

/**
 * The rows {@link defaultScopeAccountIds} needs to pick the dashboard's
 * default scope. Fetched separately from preferences so the page can run
 * both queries in parallel — the query itself doesn't depend on prefs.
 */
export const getScopeAccountRows = cache(async (userId: string) =>
  db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(visibleAccounts(userId)),
);

/**
 * The user's dashboard budget plan (their own main, or the shared plan chosen
 * via userPreferences.mainBudgetPlanId). Cached per render pass.
 */
export const getMainPlan = cache(async (userId: string) => resolveMainPlan(userId));

/**
 * Expand the scoped accounts to the set whose activity should count toward
 * "your" spending: the scoped accounts themselves, plus any account that
 * received an `internal_transfer` paired with an outflow on one of them during
 * the period.
 *
 * This handles the cross-account spending case: when the user transfers €X
 * from their main account to a secondary account and then spends from the
 * secondary, that spending was funded from the scoped accounts and should
 * still appear in the account-scoped Expenses / Free to Spend tiles.
 *
 * Returns `undefined` (meaning "no scoping") when the scope is empty.
 *
 * Cached per render pass: three dashboard cards ask for the same window, and
 * against a remote DB the duplicate round trips are pure waste.
 */
export const getFundedAccountIds = cache(async (
  userId: string,
  scopeAccountIds: string[] | undefined,
  from: string,
  to: string,
): Promise<string[] | undefined> => {
  if (!scopeAccountIds || scopeAccountIds.length === 0) return undefined;
  const rows = await db
    .select({ destAccountId: transactions.accountId })
    .from(transactions)
    .innerJoin(
      sql`transactions src`,
      sql`src.id = ${transactions.linkedTransactionId}
          AND src.user_id = ${userId}
          AND ${inArray(sql`src.account_id`, scopeAccountIds)}
          AND src.amount < 0
          AND src.date >= ${from} AND src.date <= ${to}`,
    )
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "internal_transfer"),
        sql`${transactions.amount} > 0`,
      ),
    );
  const set = new Set<string>(scopeAccountIds);
  for (const r of rows) if (r.destAccountId) set.add(r.destAccountId);
  return Array.from(set);
});

interface CategorySpend {
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  spent: number;
}

/**
 * Pot spending in a window, netted per pot (so a pot that took in more than it
 * spent contributes 0) and rolled up by the category assigned to the *pot* —
 * not to its member transactions. Same rule as /api/budgets and the Free to
 * Spend math, so a pot with a category lands in that category's budget instead
 * of an "Into pots" catch-all. Pots without a category come back under a `null`
 * categoryId.
 */
async function getPotSpendByCategory(
  userId: string,
  from: string,
  to: string,
  scopeAccountIds: string[] | undefined,
  intoPotsLabel: string,
): Promise<CategorySpend[]> {
  const scope = accountScopeFilter(scopeAccountIds);
  const rows = await db
    .select({
      categoryId: transactionGroups.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      total: sql<number>`${potSpentAmount()}`,
    })
    .from(transactionGroups)
    .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
    .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
    .where(
      and(
        eq(transactionGroups.userId, userId),
        sql`${transactions.type} != 'internal_transfer'`,
        excludeSplitParents(),
        gte(transactions.date, from),
        lte(transactions.date, to),
        ...(scope ? [scope] : []),
      ),
    )
    .groupBy(transactionGroups.id, transactionGroups.categoryId);

  const byCategory = new Map<string, CategorySpend>();
  for (const r of rows) {
    const key = r.categoryId ?? "";
    const existing = byCategory.get(key);
    if (existing) {
      existing.spent += Number(r.total) || 0;
      continue;
    }
    byCategory.set(key, {
      categoryId: r.categoryId,
      categoryName: r.categoryId ? r.categoryName : intoPotsLabel,
      categoryColor: r.categoryColor,
      categoryIcon: r.categoryId ? r.categoryIcon : "PiggyBank",
      spent: Number(r.total) || 0,
    });
  }
  return Array.from(byCategory.values());
}

/**
 * The "Not budgeted" list: transaction spending and pot spending in categories
 * that have no budget, merged so a category appearing in both shows one row.
 */
function mergeUnbudgeted(
  txByCategory: CategorySpend[],
  potByCategory: CategorySpend[],
  budgetedCategoryIds: Set<string>,
): CategorySpend[] {
  const out = new Map<string, CategorySpend>();
  // Uncategorized transactions and category-less pots stay distinct buckets,
  // hence the different fallback keys.
  const add = (rows: CategorySpend[], noCategoryKey: string) => {
    for (const r of rows) {
      if (r.categoryId && budgetedCategoryIds.has(r.categoryId)) continue;
      const existing = out.get(r.categoryId ?? noCategoryKey);
      if (existing) existing.spent += r.spent;
      else out.set(r.categoryId ?? noCategoryKey, { ...r });
    }
  };
  add(txByCategory, "uncategorized");
  add(potByCategory, "pots");
  return Array.from(out.values())
    .filter((r) => r.spent !== 0)
    .sort((a, b) => b.spent - a.spent);
}

/**
 * Budget rows for categories whose only plan is their recurring bills: one row
 * per category, capped at the monthly-normalised total of its plans.
 *
 * The Budgets page gives those categories a row, the dashboard didn't — yet it
 * counts the same bills in `totalBudgeted` and keeps their spending out of "Not
 * budgeted", so the money landed in the headline and in neither list. A
 * category that also carries an allocation is skipped: it keeps that one row,
 * exactly as the Budgets page does it, instead of being capped twice.
 */
export function fixedCostBudgetLines(
  recurringExpenses: {
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    categoryIcon: string | null;
    amount: number;
    frequency: string;
  }[],
  allocatedCategoryIds: Set<string>,
  spentByCategory: Map<string, number>,
) {
  const out = new Map<
    string,
    {
      categoryId: string;
      categoryName: string | null;
      categoryColor: string | null;
      categoryIcon: string | null;
      period: string;
      spent: number;
      limit: number;
    }
  >();
  for (const r of recurringExpenses) {
    if (!r.categoryId || allocatedCategoryIds.has(r.categoryId)) continue;
    const monthly = toMonthly(r.amount, r.frequency);
    const existing = out.get(r.categoryId);
    if (existing) {
      existing.limit += monthly;
      continue;
    }
    out.set(r.categoryId, {
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
      categoryIcon: r.categoryIcon,
      period: "monthly",
      spent: spentByCategory.get(r.categoryId) ?? 0,
      limit: monthly,
    });
  }
  return Array.from(out.values());
}

// ─── Per-widget queries ─────────────────────────────────────────────

/**
 * This month's spendable amount per category for a yearly plan: its share of
 * the envelope plus the carry-over, `target + rolloverIn`. Null for monthly
 * plans, where the allocation itself is the cap and callers use it directly.
 */
async function yearlyAllowances(
  userId: string,
  plan: ResolvedBudgetPlan | null,
  startDay: number,
): Promise<Map<string, number> | null> {
  if (plan?.period !== "yearly") return null;
  const slot = currentFinancialSlot(startDay);
  // Read-only: this runs while the dashboard renders, and a render should not
  // write. The budgets page freezes the same months when it is opened.
  const ledger = await buildLedgerYear(
    userId,
    plan,
    slot.year,
    startDay,
    new Date(),
    false,
  );
  if (ledger.length === 0) return null;

  const out = new Map<string, number>();
  for (const { categoryId, months } of ledger) {
    const month = months.find((m) => m.monthIndex === slot.monthIndex);
    if (month) out.set(categoryId, month.allowance);
  }
  return out;
}

export const loadBudgetOverview = cache(async (
  userId: string,
  startDay: number,
  planId: string | undefined,
  /** Name of the bucket for pots without a category — callers translate it. */
  intoPotsLabel: string,
) => {
  // Scoped to one budget plan: its allocations and its accounts' spending.
  // No explicit planId → the main plan (what the dashboard shows). Users
  // without plans fall back to the legacy unscoped view.
  const plan =
    planId === undefined
      ? await getMainPlan(userId)
      : await resolveBudgetPlan(userId, planId);
  // Foreign (shared) plan: every plan-scoped number runs as the OWNER — their
  // allocations, categories and financial-month window — so owner and member
  // see identical figures. Own plans: dataUserId === userId.
  const dataUserId = plan?.ownerId ?? userId;
  startDay = await effectiveStartDay(userId, plan, startDay);
  const scopeAccountIds = plan ? plan.accountIds : undefined;
  const txScope = accountScopeFilter(scopeAccountIds);
  const recurringScope =
    scopeAccountIds === undefined
      ? undefined
      : scopeAccountIds.length > 0
        ? inArray(recurringTransactions.accountId, scopeAccountIds)
        : sql`1=0`;
  const { monthStart, monthEnd, monthProgress } = getDateRanges(startDay);

  const [allBudgets, recurringExpenses, monthByCategory, monthPotSpend] =
    await Promise.all([
      db
        .select({
          id: budgets.id,
          categoryId: budgets.categoryId,
          categoryName: categories.name,
          categoryColor: categories.color,
          categoryIcon: categories.icon,
          amount: budgets.amount,
          period: budgets.period,
        })
        .from(budgets)
        .leftJoin(categories, eq(budgets.categoryId, categories.id))
        .where(
          and(
            eq(budgets.isActive, true),
            eq(budgets.status, "active"),
            eq(budgets.userId, dataUserId),
            ...(plan ? [eq(budgets.budgetId, plan.id)] : []),
          ),
        ),

      db
        .select({
          categoryId: recurringTransactions.categoryId,
          categoryName: categories.name,
          categoryColor: categories.color,
          categoryIcon: categories.icon,
          amount: recurringTransactions.amount,
          frequency: recurringTransactions.frequency,
        })
        .from(recurringTransactions)
        .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
        .where(
          and(
            eq(recurringTransactions.type, "expense"),
            eq(recurringTransactions.isActive, true),
            eq(recurringTransactions.userId, dataUserId),
            ...(recurringScope ? [recurringScope] : []),
          ),
        ),

      // Every expense in the financial month, split by category. Sums to the
      // headline total, and the categories without a budget are what the
      // "Not budgeted" list shows.
      db
        .select({
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          categoryColor: categories.color,
          categoryIcon: categories.icon,
          total: sql<number>`sum(${effectiveExpenseAmount()})`,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            eq(transactions.userId, dataUserId),
            eq(transactions.type, "expense"),
            sql`${transactions.groupId} IS NULL`,
            excludeSplitParents(),
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
            ...(txScope ? [txScope] : []),
          ),
        )
        .groupBy(transactions.categoryId),

      getPotSpendByCategory(dataUserId, monthStart, monthEnd, scopeAccountIds, intoPotsLabel),
    ]);

  // Per-budgeted-category spending — drives the per-category chips.
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
        const { from, to } = getPeriodRange(period, startDay);
        const categoryIds = periodBudgets.map((b) => b.categoryId);
        const budgeted = new Set(categoryIds);

        // Monthly budgets can reuse the month-wide queries above instead of
        // re-running them — same range, same expense math, just unfiltered by
        // category. Saves a serial round-trip wave on the common path.
        if (period === "monthly") {
          for (const r of monthByCategory) {
            if (r.categoryId && budgeted.has(r.categoryId)) {
              spendingByCategory.set(r.categoryId, Number(r.total) || 0);
            }
          }
          for (const p of monthPotSpend) {
            if (!p.categoryId || !budgeted.has(p.categoryId)) continue;
            spendingByCategory.set(
              p.categoryId,
              (spendingByCategory.get(p.categoryId) ?? 0) + p.spent,
            );
          }
          return;
        }

        const [results, potSpend] = await Promise.all([
          db
            .select({
              categoryId: transactions.categoryId,
              total: sql<number>`sum(${effectiveExpenseAmount()})`,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, dataUserId),
                inArray(transactions.categoryId, categoryIds),
                eq(transactions.type, "expense"),
                sql`${transactions.groupId} IS NULL`,
                excludeSplitParents(),
                gte(transactions.date, from),
                lte(transactions.date, to),
                ...(txScope ? [txScope] : []),
              )
            )
            .groupBy(transactions.categoryId),
          getPotSpendByCategory(dataUserId, from, to, scopeAccountIds, intoPotsLabel),
        ]);
        for (const r of results) {
          if (r.categoryId) {
            spendingByCategory.set(r.categoryId, r.total || 0);
          }
        }
        for (const p of potSpend) {
          if (!p.categoryId || !budgeted.has(p.categoryId)) continue;
          spendingByCategory.set(
            p.categoryId,
            (spendingByCategory.get(p.categoryId) ?? 0) + p.spent,
          );
        }
      }
    )
  );

  // On a yearly plan a category's cap this month is not a flat twelfth: it is
  // its share plus whatever the earlier months of the year left behind. Using
  // the ledger's allowance keeps these bars agreeing with the budgets page —
  // otherwise the dashboard would call a month "over" that the envelope is
  // comfortably funding out of earlier savings.
  const allowanceByCategory = await yearlyAllowances(dataUserId, plan, startDay);

  const allocationLines = allBudgets.map((b) => ({
    categoryId: b.categoryId,
    categoryName: b.categoryName,
    categoryColor: b.categoryColor,
    categoryIcon: b.categoryIcon,
    period: b.period,
    spent: spendingByCategory.get(b.categoryId) || 0,
    // A yearly envelope whose earlier months overspent hands this month a
    // NEGATIVE allowance. There is no such thing as a negative cap: the month
    // has nothing to spend, which is 0. Left signed it made the bar read "€0
    // of €-4.100" and pushed `totalBudgeted` below zero, hiding the card.
    limit: Math.max(0, allowanceByCategory?.get(b.categoryId) ?? b.amount),
  }));

  const allocatedCategoryIds = new Set(allBudgets.map((b) => b.categoryId));
  const monthSpendByCategory = new Map<string, number>();
  for (const r of monthByCategory) {
    if (r.categoryId) monthSpendByCategory.set(r.categoryId, Number(r.total) || 0);
  }
  for (const p of monthPotSpend) {
    if (!p.categoryId) continue;
    monthSpendByCategory.set(
      p.categoryId,
      (monthSpendByCategory.get(p.categoryId) ?? 0) + p.spent,
    );
  }
  const fixedCostLines = fixedCostBudgetLines(
    recurringExpenses,
    allocatedCategoryIds,
    monthSpendByCategory,
  );

  const budgetItems = [...allocationLines, ...fixedCostLines]
    .map((line) => {
      // Spending against a cap of nothing is over budget, not "ok" — the old
      // `: 0` fallback reported a blown zero-allowance envelope as healthy.
      const pct =
        line.limit > 0
          ? (line.spent / line.limit) * 100
          : line.spent > 0
            ? 100
            : 0;
      return {
        ...line,
        percentage: Math.round(pct),
        status: (pct >= 100
          ? "exceeded"
          : pct >= 80
            ? "warning"
            : "ok") as "ok" | "warning" | "exceeded",
      };
    })
    .sort((a, b) => b.percentage - a.percentage);

  // Headline totals treat recurring fixed costs as part of the budget too —
  // money is still flowing out, so a "budget spent vs. budget total" bar
  // should reflect both committed envelopes and recurring bills.
  //
  // Summed off the ROWS, not off the source queries, so the headline can never
  // disagree with the list beneath it. That is the whole point: a plan whose
  // sub-line stands for a recurring bill has that bill inside the allocation
  // already (POST /api/budgets rolls the tree up into `budgets.amount`), and
  // adding every active plan on top counted it twice — a €1.000 rent read as
  // €2.000 budgeted against one €1.000 row. `fixedCostBudgetLines` is the rule
  // for which plans still deserve a budget of their own; this follows it.
  const totalBudgeted = [...allocationLines, ...fixedCostLines].reduce(
    (s, line) => s + line.limit,
    0,
  );

  // Spending in categories with no budget (incl. uncategorized), plus pots that
  // have no category of their own. A category with an active recurring expense
  // is already budgeted as a fixed cost. The Budgets page keeps those out of
  // manual allocations, so treating them as unbudgeted here made the dashboard
  // contradict that page.
  const budgetedCategoryIds = new Set([
    ...allocatedCategoryIds,
    ...fixedCostLines.map((l) => l.categoryId),
  ]);
  const unbudgetedItems = mergeUnbudgeted(
    monthByCategory.map((r) => ({
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryColor: r.categoryColor,
      categoryIcon: r.categoryIcon,
      spent: Number(r.total) || 0,
    })),
    monthPotSpend,
    budgetedCategoryIds,
  );
  const unbudgetedTotal = unbudgetedItems.reduce((s, r) => s + r.spent, 0);

  // Only spending that has a budget behind it counts against the headline —
  // it is measured against `totalBudgeted`, and unbudgeted categories add
  // nothing to that side. Counting them made the bar read "over budget" for
  // anyone who does not allocate every category. They are listed on their own
  // below (`unbudgetedItems`), which is where that money belongs.
  const txTotal = monthByCategory.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const potExpense = monthPotSpend.reduce((s, r) => s + r.spent, 0);
  const totalBudgetSpent = txTotal + potExpense - unbudgetedTotal;

  // The plan's accounts, for the card's links into /transactions: every figure
  // on the card counts only these accounts, so the list behind it should too.
  // Narrowed to what the CALLER can see — a shared plan may hold accounts that
  // were never shared with them, and those would only add a filter naming rows
  // they cannot read.
  let linkAccountIds: string[] = [];
  if (plan) {
    if (plan.ownerId === userId) {
      linkAccountIds = plan.accountIds;
    } else {
      const visible = new Set((await getScopeAccountRows(userId)).map((a) => a.id));
      linkAccountIds = plan.accountIds.filter((id) => visible.has(id));
    }
  }

  return {
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          isMain: plan.isMain,
          role: plan.role,
          ownerName: plan.ownerName,
          accountIds: linkAccountIds,
        }
      : null,
    budgetItems,
    unbudgetedItems,
    unbudgetedTotal,
    totalBudgeted,
    totalBudgetSpent,
    monthProgress,
    /** First day of the financial month these figures cover (YYYY-MM-DD). */
    monthStart,
    /** Rows that stand for recurring bills rather than an allocation. */
    fixedCostCategoryIds: fixedCostLines.map((l) => l.categoryId),
  };
});

export type BudgetOverview = Awaited<ReturnType<typeof loadBudgetOverview>>;
