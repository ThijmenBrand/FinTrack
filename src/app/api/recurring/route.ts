import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recurringTransactions,
  accounts,
  categories,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { getNextOccurrence } from "@/lib/recurring";
import { isFiniteNumber, isIsoDate } from "@/lib/validation";

const RECURRING_TYPES = ["income", "expense"] as const;
const FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const;
type RecurringType = (typeof RECURRING_TYPES)[number];
type Frequency = (typeof FREQUENCIES)[number];

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Validate the client-supplied recurring-transaction fields that are present
 * in `body`. Returns an error message, or null if everything present is valid.
 */
function validateRecurringFields(body: Record<string, unknown>): string | null {
  if ("amount" in body && !isFiniteNumber(body.amount)) return "amount must be a finite number";
  if ("type" in body && !RECURRING_TYPES.includes(body.type as RecurringType))
    return `type must be one of: ${RECURRING_TYPES.join(", ")}`;
  if ("frequency" in body && !FREQUENCIES.includes(body.frequency as Frequency))
    return `frequency must be one of: ${FREQUENCIES.join(", ")}`;
  if ("description" in body && (typeof body.description !== "string" || !body.description.trim()))
    return "description must be a non-empty string";
  if ("startDate" in body && !isIsoDate(body.startDate)) return "startDate must be YYYY-MM-DD";
  if ("endDate" in body && body.endDate != null && body.endDate !== "" && !isIsoDate(body.endDate))
    return "endDate must be YYYY-MM-DD";
  if ("dayOfWeek" in body && body.dayOfWeek != null && !isIntInRange(body.dayOfWeek, 0, 6))
    return "dayOfWeek must be 0-6";
  if ("dayOfMonth" in body && body.dayOfMonth != null && !isIntInRange(body.dayOfMonth, 1, 31))
    return "dayOfMonth must be 1-31";
  if ("monthOfYear" in body && body.monthOfYear != null && !isIntInRange(body.monthOfYear, 1, 12))
    return "monthOfYear must be 1-12";
  return null;
}

async function userOwnsAccount(userId: string, accountId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1);
  return !!row;
}

async function userOwnsCategory(userId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return !!row;
}

// GET /api/recurring — list all recurring transactions with next occurrence
export async function GET() {
  return withUser(async (userId) => {
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
  }, "Failed to fetch recurring transactions");
}

// POST /api/recurring — create a recurring transaction
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
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

    const invalid = validateRecurringFields(body);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    if (!(await userOwnsAccount(userId, accountId))) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (categoryId && !(await userOwnsCategory(userId, categoryId))) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const id = crypto.randomUUID();
    await db.insert(recurringTransactions).values({
      id,
      accountId,
      description,
      amount: type === "income" ? Math.abs(amount) : -Math.abs(amount),
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
  }, "Failed to create recurring transaction");
}

// PUT /api/recurring — update a recurring transaction
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    const invalid = validateRecurringFields(body);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)))
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body.accountId && !(await userOwnsAccount(userId, body.accountId))) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (body.categoryId && !(await userOwnsCategory(userId, body.categoryId))) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Explicit field allowlist — never spread the client body into `set`
    // (userId/createdAt/id must not be client-settable).
    const updates: Partial<typeof recurringTransactions.$inferInsert> = {};
    if ("description" in body) updates.description = (body.description as string).trim();
    if ("type" in body) updates.type = body.type;
    if ("categoryId" in body) updates.categoryId = body.categoryId || null;
    if ("accountId" in body) updates.accountId = body.accountId;
    if ("frequency" in body) updates.frequency = body.frequency;
    if ("dayOfWeek" in body) updates.dayOfWeek = body.dayOfWeek ?? null;
    if ("dayOfMonth" in body) updates.dayOfMonth = body.dayOfMonth ?? null;
    if ("monthOfYear" in body) updates.monthOfYear = body.monthOfYear ?? null;
    if ("startDate" in body) updates.startDate = body.startDate;
    if ("endDate" in body) updates.endDate = body.endDate || null;
    if ("isActive" in body) updates.isActive = Boolean(body.isActive);
    if ("amount" in body) {
      // Ensure amount sign matches the (possibly updated) type.
      const effectiveType = (updates.type ?? existing.type) as string;
      updates.amount =
        effectiveType === "income" ? Math.abs(body.amount) : -Math.abs(body.amount);
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(recurringTransactions)
        .set(updates)
        .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    }

    return NextResponse.json({ success: true });
  }, "Failed to update recurring transaction");
}

// DELETE /api/recurring — delete a recurring transaction
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
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
  }, "Failed to delete recurring transaction");
}
