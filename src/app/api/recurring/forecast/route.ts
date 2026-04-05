import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recurringTransactions,
  accounts,
  transactions,
  categories,
} from "@/db/schema";
import { eq, and, sum } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

/**
 * Generate all occurrences of a recurring transaction between two dates.
 */
function generateOccurrences(
  frequency: string,
  startDate: string,
  endDate: string | null,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  monthOfYear: number | null,
  forecastFrom: Date,
  forecastTo: Date
): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : forecastTo;
  const effectiveEnd = end < forecastTo ? end : forecastTo;

  let current = new Date(Math.max(start.getTime(), forecastFrom.getTime()));
  current.setHours(0, 0, 0, 0);

  // Align to first valid occurrence
  switch (frequency) {
    case "weekly": {
      const targetDow = dayOfWeek ?? start.getDay();
      while (current.getDay() !== targetDow) {
        current.setDate(current.getDate() + 1);
      }
      while (current <= effectiveEnd) {
        dates.push(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 7);
      }
      break;
    }
    case "biweekly": {
      const diffMs = current.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const remainder = ((diffDays % 14) + 14) % 14;
      if (remainder !== 0) {
        current.setDate(current.getDate() + (14 - remainder));
      }
      while (current <= effectiveEnd) {
        dates.push(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 14);
      }
      break;
    }
    case "monthly": {
      const dom = dayOfMonth ?? start.getDate();
      let year = current.getFullYear();
      let month = current.getMonth();
      if (current.getDate() > dom) month += 1;
      while (true) {
        if (month > 11) { month -= 12; year += 1; }
        const lastDay = new Date(year, month + 1, 0).getDate();
        const d = new Date(year, month, Math.min(dom, lastDay));
        if (d > effectiveEnd) break;
        if (d >= forecastFrom) dates.push(d.toISOString().slice(0, 10));
        month += 1;
      }
      break;
    }
    case "yearly": {
      const moy = (monthOfYear ?? start.getMonth() + 1) - 1;
      const dom = dayOfMonth ?? start.getDate();
      let year = current.getFullYear();
      while (true) {
        const lastDay = new Date(year, moy + 1, 0).getDate();
        const d = new Date(year, moy, Math.min(dom, lastDay));
        if (d > effectiveEnd) break;
        if (d >= forecastFrom) dates.push(d.toISOString().slice(0, 10));
        year += 1;
      }
      break;
    }
  }

  return dates;
}

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
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const months = Math.min(12, Math.max(1, Number(searchParams.get("months")) || 3));

    // 1. Get current total balance
    const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    let totalBalance = 0;
    for (const account of allAccounts) {
      const result = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(eq(transactions.accountId, account.id));
      totalBalance += account.initialBalance + (Number(result[0]?.total) || 0);
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
        });
      }
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
      .reduce((s, r) => {
        const mult =
          r.frequency === "weekly" ? 4.33 :
          r.frequency === "biweekly" ? 2.17 :
          r.frequency === "yearly" ? 1 / 12 : 1;
        return s + Math.abs(r.amount) * mult;
      }, 0);

    const monthlyRecurringExpenses = recurring
      .filter((r) => r.type === "expense")
      .reduce((s, r) => {
        const mult =
          r.frequency === "weekly" ? 4.33 :
          r.frequency === "biweekly" ? 2.17 :
          r.frequency === "yearly" ? 1 / 12 : 1;
        return s + Math.abs(r.amount) * mult;
      }, 0);

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
  } catch (error) {
    console.error("Failed to generate forecast:", error);
    return NextResponse.json(
      { error: "Failed to generate forecast" },
      { status: 500 }
    );
  }
}
