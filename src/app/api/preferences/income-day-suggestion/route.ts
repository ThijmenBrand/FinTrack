import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";

export interface IncomeDaySuggestion {
  day: number;
  totalIncome: number;
  monthsObserved: number;
}

export async function GET() {
  return withUser(async (userId) => {
    const now = new Date();
    const lookback = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    const lookbackIso = lookback.toISOString().slice(0, 10);

    const rows = await db
      .select({
        day: sql<number>`cast(substr(${transactions.date}, 9, 2) as integer)`,
        totalIncome: sql<number>`sum(${transactions.amount})`,
        monthsObserved: sql<number>`count(distinct substr(${transactions.date}, 1, 7))`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "income"),
          gte(transactions.date, lookbackIso),
        ),
      )
      .groupBy(sql`cast(substr(${transactions.date}, 9, 2) as integer)`);

    if (rows.length === 0) {
      return NextResponse.json<{ suggestion: IncomeDaySuggestion | null }>({ suggestion: null });
    }

    const best = rows.reduce((acc, r) => (r.totalIncome > acc.totalIncome ? r : acc));
    const day = Math.max(1, Math.min(28, best.day));

    return NextResponse.json<{ suggestion: IncomeDaySuggestion }>({
      suggestion: {
        day,
        totalIncome: best.totalIncome,
        monthsObserved: best.monthsObserved,
      },
    });
  }, "Failed to compute suggestion");
}
