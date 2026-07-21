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
import { generateOccurrences } from "@/lib/recurring";
import { toMonthly } from "@/lib/month-money";

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
    const { searchParams } = new URL(request.url);
    const months = Math.min(12, Math.max(1, Number(searchParams.get("months")) || 3));

    // 1. Get current total balance: initial balances + one grouped sum of
    // transaction amounts per account (instead of one query per account).
    const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    const balanceRows = await db
      .select({ accountId: transactions.accountId, total: sum(transactions.amount) })
      .from(transactions)
      .where(eq(transactions.userId, userId))
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
        events.push({
          date,
          description: r.description,
          amount: r.amount,
          type: r.type,
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
      const label = new Date(year, month, 1).toLocaleDateString("en-US", {
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

    // Monthly recurring totals
    const monthlyRecurringIncome = recurring
      .filter((r) => r.type === "income")
      .reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0);

    const monthlyRecurringExpenses = recurring
      .filter((r) => r.type === "expense")
      .reduce((s, r) => s + toMonthly(r.amount, r.frequency), 0);

    const monthlyNet = monthlyRecurringIncome - monthlyRecurringExpenses;

    if (monthlyNet > 0) {
      advice.push({
        type: "success",
        message: `Your recurring income exceeds expenses by €${monthlyNet.toFixed(2)}/month. You could save €${(monthlyNet * 12).toFixed(2)} per year at this rate.`,
      });
    } else if (monthlyNet < 0) {
      advice.push({
        type: "warning",
        message: `Your recurring expenses exceed income by €${Math.abs(monthlyNet).toFixed(2)}/month. Review subscriptions or find ways to increase income.`,
      });
    }

    // Check if balance will go negative
    const negativeMonth = monthlyForecast.find((m) => m.endBalance < 0);
    if (negativeMonth) {
      advice.push({
        type: "warning",
        message: `Your balance is projected to go negative in ${negativeMonth.label}. Consider reducing expenses or building a buffer.`,
      });
    }

    // Savings rate
    if (monthlyRecurringIncome > 0) {
      const savingsRate = (monthlyNet / monthlyRecurringIncome) * 100;
      if (savingsRate >= 20) {
        advice.push({
          type: "success",
          message: `Great savings rate of ${savingsRate.toFixed(0)}% — you're saving more than the recommended 20%.`,
        });
      } else if (savingsRate >= 0) {
        advice.push({
          type: "info",
          message: `Your savings rate is ${savingsRate.toFixed(0)}%. Financial experts recommend saving at least 20% of income.`,
        });
      }
    }

    // Subscription check
    const subscriptionCount = recurring.filter(
      (r) => r.type === "expense" && (r.frequency === "monthly" || r.frequency === "yearly")
    ).length;
    if (subscriptionCount > 5) {
      advice.push({
        type: "info",
        message: `You have ${subscriptionCount} recurring subscriptions. Consider auditing them — unused subscriptions add up quickly.`,
      });
    }

    // Emergency fund check
    if (monthlyRecurringExpenses > 0) {
      const monthsCovered = totalBalance / monthlyRecurringExpenses;
      if (monthsCovered < 3) {
        advice.push({
          type: "warning",
          message: `Your balance covers only ${monthsCovered.toFixed(1)} months of recurring expenses. An emergency fund of 3-6 months is recommended.`,
        });
      } else if (monthsCovered >= 6) {
        advice.push({
          type: "success",
          message: `Your balance covers ${monthsCovered.toFixed(1)} months of expenses — a solid emergency fund.`,
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
