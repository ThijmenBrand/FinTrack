import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recurringTransactions,
  accounts,
  categories,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

/**
 * Calculate the next occurrence date for a recurring transaction.
 */
function getNextOccurrence(
  frequency: string,
  startDate: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  monthOfYear: number | null,
  refDate: Date = new Date()
): string {
  const ref = new Date(refDate);
  ref.setHours(0, 0, 0, 0);

  switch (frequency) {
    case "weekly": {
      const targetDow = dayOfWeek ?? new Date(startDate).getDay();
      const current = ref.getDay();
      let daysAhead = targetDow - current;
      if (daysAhead <= 0) daysAhead += 7;
      const next = new Date(ref);
      next.setDate(next.getDate() + daysAhead);
      return next.toISOString().slice(0, 10);
    }
    case "biweekly": {
      const start = new Date(startDate);
      const diffMs = ref.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const cycleDay = ((diffDays % 14) + 14) % 14;
      const daysUntil = cycleDay === 0 ? 14 : 14 - cycleDay;
      const next = new Date(ref);
      next.setDate(next.getDate() + daysUntil);
      return next.toISOString().slice(0, 10);
    }
    case "monthly": {
      const dom = dayOfMonth ?? new Date(startDate).getDate();
      let year = ref.getFullYear();
      let month = ref.getMonth();
      // If we're past this month's day, go to next month
      if (ref.getDate() >= dom) {
        month += 1;
        if (month > 11) {
          month = 0;
          year += 1;
        }
      }
      // Clamp to valid day (e.g., Feb 31 -> Feb 28)
      const lastDay = new Date(year, month + 1, 0).getDate();
      const actualDay = Math.min(dom, lastDay);
      return new Date(year, month, actualDay).toISOString().slice(0, 10);
    }
    case "yearly": {
      const moy = (monthOfYear ?? new Date(startDate).getMonth() + 1) - 1; // 0-indexed
      const dom2 = dayOfMonth ?? new Date(startDate).getDate();
      let year = ref.getFullYear();
      const thisYearDate = new Date(year, moy, Math.min(dom2, new Date(year, moy + 1, 0).getDate()));
      if (ref >= thisYearDate) {
        year += 1;
      }
      const lastDay = new Date(year, moy + 1, 0).getDate();
      return new Date(year, moy, Math.min(dom2, lastDay))
        .toISOString()
        .slice(0, 10);
    }
    default:
      return startDate;
  }
}

// GET /api/recurring — list all recurring transactions with next occurrence
export async function GET() {
  try {
    const userId = await getUserId();

    const rows = await db
      .select({
        id: recurringTransactions.id,
        accountId: recurringTransactions.accountId,
        accountName: accounts.name,
        description: recurringTransactions.description,
        amount: recurringTransactions.amount,
        type: recurringTransactions.type,
        categoryId: recurringTransactions.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        frequency: recurringTransactions.frequency,
        dayOfWeek: recurringTransactions.dayOfWeek,
        dayOfMonth: recurringTransactions.dayOfMonth,
        monthOfYear: recurringTransactions.monthOfYear,
        startDate: recurringTransactions.startDate,
        endDate: recurringTransactions.endDate,
        isActive: recurringTransactions.isActive,
        createdAt: recurringTransactions.createdAt,
      })
      .from(recurringTransactions)
      .leftJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
      .leftJoin(
        categories,
        eq(recurringTransactions.categoryId, categories.id)
      )
      .where(eq(recurringTransactions.userId, userId));

    const withNextOccurrence = rows.map((r) => ({
      ...r,
      nextOccurrence: r.isActive
        ? getNextOccurrence(
            r.frequency,
            r.startDate,
            r.dayOfWeek,
            r.dayOfMonth,
            r.monthOfYear
          )
        : null,
    }));

    return NextResponse.json(withNextOccurrence);
  } catch (error) {
    console.error("Failed to fetch recurring transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch recurring transactions" },
      { status: 500 }
    );
  }
}

// POST /api/recurring — create a recurring transaction
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const {
      accountId,
      description,
      amount,
      type,
      categoryId,
      frequency,
      dayOfWeek,
      dayOfMonth,
      monthOfYear,
      startDate,
      endDate,
    } = body;

    if (!accountId || !description || amount === undefined || !type || !frequency || !startDate) {
      return NextResponse.json(
        { error: "accountId, description, amount, type, frequency, and startDate are required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(recurringTransactions).values({
      id,
      accountId,
      description,
      amount: type === "expense" ? -Math.abs(amount) : Math.abs(amount),
      type,
      categoryId: categoryId || null,
      frequency,
      dayOfWeek: dayOfWeek ?? null,
      dayOfMonth: dayOfMonth ?? null,
      monthOfYear: monthOfYear ?? null,
      startDate,
      endDate: endDate || null,
      isActive: true,
      userId,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create recurring transaction:", error);
    return NextResponse.json(
      { error: "Failed to create recurring transaction" },
      { status: 500 }
    );
  }
}

// PUT /api/recurring — update a recurring transaction
export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    // Ensure amount sign matches type
    if (updates.amount !== undefined && updates.type) {
      updates.amount =
        updates.type === "expense"
          ? -Math.abs(updates.amount)
          : Math.abs(updates.amount);
    }

    await db
      .update(recurringTransactions)
      .set(updates)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update recurring transaction:", error);
    return NextResponse.json(
      { error: "Failed to update recurring transaction" },
      { status: 500 }
    );
  }
}

// DELETE /api/recurring — delete a recurring transaction
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    await db
      .delete(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete recurring transaction:", error);
    return NextResponse.json(
      { error: "Failed to delete recurring transaction" },
      { status: 500 }
    );
  }
}
