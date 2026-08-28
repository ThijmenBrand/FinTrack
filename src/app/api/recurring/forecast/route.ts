import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recurringTransactions,
  accounts,
  transactions,
  categories,
  transactionGroups,
} from "@/db/schema";
import { eq, and, sum, isNotNull, gte, lte } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { generateOccurrences, isOccurrencePaid } from "@/lib/recurring";
import { lastPaidByPlan } from "@/lib/recurring-paid";
import { toMonthly } from "@/lib/month-money";
import { getI18n } from "@/lib/i18n/server";
import { excludeSplitChildren } from "@/lib/split-sql";

/**
 * GET /api/recurring/forecast
 * Query params: months (default: 3)
 *
 * Returns:
 *  - currentBalance: total across all accounts
 *  - monthlyForecast: projected balance per month with income/expense breakdown
 *  - upcomingPayments: next N payments sorted by date
 *  - advice: smart tips based on cash flow analysis
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { t, intlLocale, formatCurrency } = await getI18n();
    const { searchParams } = new URL(request.url);
    const months = Math.min(12, Math.max(1, Number(searchParams.get("months")) || 3));

    // 1. Get current total balance: initial balances + one grouped sum of
    // transaction amounts per account (instead of one query per account).
    const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    const balanceRows = await db
      .select({ accountId: transactions.accountId, total: sum(transactions.amount) })
      .from(transactions)
      // Starting balance is the real ledger: parents in, their children out.
      .where(and(eq(transactions.userId, userId), excludeSplitChildren()))
      .groupBy(transactions.accountId);
    const balanceByAccount = new Map(
      balanceRows.map((r) => [r.accountId, Number(r.total) || 0])
    );
    let totalBalance = 0;
    for (const account of allAccounts) {
      totalBalance += account.initialBalance + (balanceByAccount.get(account.id) || 0);
    }

    // 2. Get active recurring transactions
    const recurring = await db
      .select({
        id: recurringTransactions.id,
        description: recurringTransactions.description,
        amount: recurringTransactions.amount,
        type: recurringTransactions.type,
        // A plan in a transfer category moves money between your own accounts.
        // It is neither income nor expense — same rule as `isBudgetable` on the
        // budget side.
        categoryKind: categories.kind,
        categoryName: categories.name,
        categoryColor: categories.color,
        frequency: recurringTransactions.frequency,
        dayOfWeek: recurringTransactions.dayOfWeek,
        dayOfMonth: recurringTransactions.dayOfMonth,
        monthOfYear: recurringTransactions.monthOfYear,
        startDate: recurringTransactions.startDate,
        endDate: recurringTransactions.endDate,
      })
      .from(recurringTransactions)
      .leftJoin(
        categories,
        eq(recurringTransactions.categoryId, categories.id)
      )
      .where(and(eq(recurringTransactions.isActive, true), eq(recurringTransactions.userId, userId)));

    // 3. Build forecast
    const now = new Date();
    const forecastFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const forecastTo = new Date(now.getFullYear(), now.getMonth() + months + 1, 0);

    // Collect all upcoming events
    interface ForecastEvent {
      date: string;
      description: string;
      amount: number;
      type: string;
      categoryName: string | null;
      categoryColor: string | null;
      source: "recurring" | "spike";
    }

    const events: ForecastEvent[] = [];

    // An occurrence whose payment already landed is history, not forecast —
    // keeping it would show a paid bill as upcoming and double-count it in the
    // projected balance.
    const lastPaid = await lastPaidByPlan(recurring.map((r) => r.id), userId);

    for (const r of recurring) {
      const occurrences = generateOccurrences(
        r.frequency,
        r.startDate,
        r.endDate,
        r.dayOfWeek,
        r.dayOfMonth,
        r.monthOfYear,
        forecastFrom,
        forecastTo
      );
      for (const date of occurrences) {
        if (isOccurrencePaid(r.frequency, date, lastPaid.get(r.id))) continue;
        events.push({
          date,
          description: r.description,
          amount: r.amount,
          // Kept in the event list so it still shows under Upcoming — but as
          // its own type, which drops it out of both monthly sums below and so
          // leaves the projected balance untouched, which is the truth: the
          // money moved between two accounts this forecast already adds up.
          type: r.categoryKind === "transfer" ? "transfer" : r.type,
          categoryName: r.categoryName,
          categoryColor: r.categoryColor,
          source: "recurring",
        });
      }
    }

    // Inject planned spikes (pots with a target date in the forecast window)
    // as full-targetAmount expected expenses. Money still leaves the account
    // on the target date regardless of how much has been pre-funded — funding
    // is a planning aid, not a forecast modifier.
    const forecastFromIso = forecastFrom.toISOString().slice(0, 10);
    const forecastToIso = forecastTo.toISOString().slice(0, 10);
    const spikes = await db
      .select({
        name: transactionGroups.name,
        targetAmount: transactionGroups.targetAmount,
        targetDate: transactionGroups.targetDate,
        categoryName: categories.name,
        categoryColor: categories.color,
      })
      .from(transactionGroups)
      .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
      .where(
        and(
          eq(transactionGroups.userId, userId),
          isNotNull(transactionGroups.targetAmount),
          isNotNull(transactionGroups.targetDate),
          gte(transactionGroups.targetDate, forecastFromIso),
          lte(transactionGroups.targetDate, forecastToIso)
        )
      );

    for (const s of spikes) {
      if (s.targetAmount == null || !s.targetDate) continue;
      events.push({
        date: s.targetDate,
        description: `${s.name} (planned)`,
        amount: -Math.abs(s.targetAmount),
        type: "expense",
        categoryName: s.categoryName,
        categoryColor: s.categoryColor,
        source: "spike",
      });
    }

    events.sort((a, b) => a.date.localeCompare(b.date));

    // 4. Monthly forecast with running balance
    const monthlyForecast: {
      month: string;
      label: string;
      income: number;
      expenses: number;
      net: number;
      endBalance: number;
    }[] = [];

    let runningBalance = totalBalance;

    for (let i = 0; i <= months; i++) {
      const year = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
      const month = (now.getMonth() + i) % 12;
      const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
      const label = new Date(year, month, 1).toLocaleDateString(intlLocale, {
        month: "short",
        year: "numeric",
      });

      const monthEvents = events.filter((e) => e.date.startsWith(monthStr));
      const income = monthEvents
        .filter((e) => e.type === "income")
        .reduce((s, e) => s + Math.abs(e.amount), 0);
      const expenses = monthEvents
        .filter((e) => e.type === "expense")
        .reduce((s, e) => s + Math.abs(e.amount), 0);
      const net = income - expenses;
      runningBalance += net;

      monthlyForecast.push({
        month: monthStr,
        label,
        income,
        expenses,
        net,
        endBalance: runningBalance,
      });
    }

    // 5. Upcoming payments (next 15)
    const upcomingPayments = events.slice(0, 15);

    // 6. Smart advice
    const advice: { type: "info" | "warning" | "success"; message: string }[] = [];

    // Monthly recurring totals. Transfers are left out of both sides: the
    // outgoing leg and its matching incoming leg would otherwise inflate the
    // gross in/out figures — and the savings rate derived from them — by the
    // same amount of money that never entered or left.
    const cashFlowPlans = recurring.filter((r) => r.categoryKind !== "transfer");

    const monthlyRecurringIncome = cashFlowPlans
      .filter((r) => r.type === "income")
      .reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0);

    const monthlyRecurringExpenses = cashFlowPlans
      .filter((r) => r.type === "expense")
      .reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0);

    const monthlyNet = monthlyRecurringIncome - monthlyRecurringExpenses;

    if (monthlyNet > 0) {
      advice.push({
        type: "success",
        message: t("forecast.surplus", {
          monthly: formatCurrency(monthlyNet),
          yearly: formatCurrency(monthlyNet * 12),
        }),
      });
    } else if (monthlyNet < 0) {
      advice.push({
        type: "warning",
        message: t("forecast.deficit", {
          monthly: formatCurrency(Math.abs(monthlyNet)),
        }),
      });
    }

    // Check if balance will go negative
    const negativeMonth = monthlyForecast.find((m) => m.endBalance < 0);
    if (negativeMonth) {
      advice.push({
        type: "warning",
        message: t("forecast.negativeMonth", { month: negativeMonth.label }),
      });
    }

    // Savings rate
    if (monthlyRecurringIncome > 0) {
      const savingsRate = (monthlyNet / monthlyRecurringIncome) * 100;
      if (savingsRate >= 20) {
        advice.push({
          type: "success",
          message: t("forecast.goodSavings", { rate: savingsRate.toFixed(0) }),
        });
      } else if (savingsRate >= 0) {
        advice.push({
          type: "info",
          message: t("forecast.savingsRate", { rate: savingsRate.toFixed(0) }),
        });
      }
    }

    // Subscription check
    const subscriptionCount = cashFlowPlans.filter(
      (r) => r.type === "expense" && (r.frequency === "monthly" || r.frequency === "yearly")
    ).length;
    if (subscriptionCount > 5) {
      advice.push({
        type: "info",
        message: t("forecast.manySubscriptions", { count: subscriptionCount }),
      });
    }

    // Emergency fund check
    if (monthlyRecurringExpenses > 0) {
      const monthsCovered = totalBalance / monthlyRecurringExpenses;
      if (monthsCovered < 3) {
        advice.push({
          type: "warning",
          message: t("forecast.thinBuffer", { months: monthsCovered.toFixed(1) }),
        });
      } else if (monthsCovered >= 6) {
        advice.push({
          type: "success",
          message: t("forecast.solidBuffer", { months: monthsCovered.toFixed(1) }),
        });
      }
    }

    return NextResponse.json({
      currentBalance: totalBalance,
      monthlyRecurringIncome,
      monthlyRecurringExpenses,
      monthlyNet,
      monthlyForecast,
      upcomingPayments,
      advice,
    });
  }, "Failed to generate forecast");
}
