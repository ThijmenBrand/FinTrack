import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  transactionGroups,
  transactions,
  categories,
  auditLog,
} from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { getPaySchedule, paydaysBetween } from "@/lib/pay-schedule";
import { classifyOnTrack } from "@/lib/on-track";

// GET /api/pots/[id]/details — bundle of pot info + spike stats +
// allocation history (from audit log) + linked transactions.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withUser(async (userId) => {
    const { id } = await params;

    const pot = await db
      .select({
        id: transactionGroups.id,
        name: transactionGroups.name,
        categoryId: transactionGroups.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        targetAmount: transactionGroups.targetAmount,
        targetDate: transactionGroups.targetDate,
        fundedAmount: transactionGroups.fundedAmount,
        createdAt: transactionGroups.createdAt,
      })
      .from(transactionGroups)
      .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
      .where(
        and(
          eq(transactionGroups.id, id),
          eq(transactionGroups.userId, userId)
        )
      )
      .get();

    if (!pot) {
      return NextResponse.json({ error: "Pot not found" }, { status: 404 });
    }

    // Spike stats — only when both target fields are set.
    let spike: {
      daysUntil: number;
      paydaysRemaining: number;
      suggestedAllocation: number;
      expectedFundedByNow: number;
      onTrack: "ahead" | "on_pace" | "behind";
      paydaySchedule: { date: string; expectedFunded: number }[];
    } | null = null;

    if (pot.targetAmount != null && pot.targetDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(pot.targetDate);
      target.setHours(0, 0, 0, 0);
      const created = new Date(pot.createdAt);
      created.setHours(0, 0, 0, 0);

      const schedule = await getPaySchedule(userId);

      const daysUntil = Math.max(
        0,
        Math.round((target.getTime() - today.getTime()) / 86400000)
      );

      const paydaysRem = paydaysBetween(schedule, today, target);
      const paydaysRemaining = paydaysRem.length;

      const totalPaydaysList = paydaysBetween(
        schedule,
        created < today ? created : today,
        target
      );
      const totalPaydays = totalPaydaysList.length;
      const elapsedPaydaysList = paydaysBetween(schedule, created, today);
      const elapsedPaydays = elapsedPaydaysList.length;

      const remaining = Math.max(0, pot.targetAmount - pot.fundedAmount);
      const suggested = Math.max(
        0,
        remaining / Math.max(1, paydaysRemaining)
      );

      const { expectedFundedByNow, onTrack } = classifyOnTrack({
        fundedAmount: pot.fundedAmount,
        targetAmount: pot.targetAmount,
        totalPaydays,
        elapsedPaydays,
      });

      const paydaySchedule = totalPaydaysList.map((date, i) => ({
        date,
        expectedFunded: Math.min(
          pot.targetAmount!,
          (pot.targetAmount! / totalPaydays) * (i + 1)
        ),
      }));

      spike = {
        daysUntil,
        paydaysRemaining,
        suggestedAllocation: suggested,
        expectedFundedByNow,
        onTrack,
        paydaySchedule,
      };
    }

    // Allocation history from the audit log. Earliest first.
    const allocationRows = await db
      .select({
        details: auditLog.details,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "pot.allocate"),
          eq(auditLog.targetId, id),
          eq(auditLog.userId, userId)
        )
      )
      .orderBy(asc(auditLog.createdAt));

    const allocations = allocationRows
      .map((row) => {
        try {
          const parsed = row.details ? JSON.parse(row.details) : null;
          if (!parsed) return null;
          const delta = Number(parsed.delta);
          const fundedAfter = Number(parsed.fundedAmount);
          if (!Number.isFinite(delta) || !Number.isFinite(fundedAfter))
            return null;
          return {
            date: row.createdAt,
            delta,
            fundedAfter,
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const linkedTransactions = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        amount: transactions.amount,
        type: transactions.type,
        categoryName: categories.name,
        categoryColor: categories.color,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          eq(transactions.groupId, id),
          eq(transactions.userId, userId)
        )
      )
      .orderBy(desc(transactions.date));

    const netAmount = linkedTransactions.reduce((s, t) => s + t.amount, 0);

    return NextResponse.json({
      pot: {
        id: pot.id,
        name: pot.name,
        categoryId: pot.categoryId,
        categoryName: pot.categoryName,
        categoryColor: pot.categoryColor,
        targetAmount: pot.targetAmount,
        targetDate: pot.targetDate,
        fundedAmount: pot.fundedAmount,
        netAmount,
        transactionCount: linkedTransactions.length,
        createdAt: pot.createdAt,
      },
      spike,
      allocations,
      transactions: linkedTransactions,
    });
  }, "Failed to fetch pot details");
}
