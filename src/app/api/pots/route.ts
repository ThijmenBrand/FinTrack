import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactionGroups, transactions, categories } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";

// GET /api/pots — list all pots with net amount, transaction count, category info
export async function GET() {
  return withUser(async (userId) => {
    const pots = await db
      .select({
        id: transactionGroups.id,
        name: transactionGroups.name,
        categoryId: transactionGroups.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        targetAmount: transactionGroups.targetAmount,
        targetDate: transactionGroups.targetDate,
        fundedAmount: transactionGroups.fundedAmount,
        archivedAt: transactionGroups.archivedAt,
        createdAt: transactionGroups.createdAt,
        netAmount: sql<number>`COALESCE((
          SELECT SUM(t.amount) FROM transactions t WHERE t.group_id = ${transactionGroups.id} AND t.user_id = ${userId}
        ), 0)`,
        transactionCount: sql<number>`(
          SELECT COUNT(*) FROM transactions t WHERE t.group_id = ${transactionGroups.id} AND t.user_id = ${userId}
        )`,
      })
      .from(transactionGroups)
      .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
      .where(eq(transactionGroups.userId, userId))
      .orderBy(sql`${transactionGroups.createdAt} DESC`);

    return NextResponse.json(pots);
  }, "Failed to fetch pots");
}

// Validate that a target, if provided, has both amount > 0 and a date.
function validateTarget(targetAmount: unknown, targetDate: unknown): string | null {
  const hasAmount = targetAmount !== undefined && targetAmount !== null;
  const hasDate = targetDate !== undefined && targetDate !== null && targetDate !== "";
  if (hasAmount !== hasDate) {
    return "targetAmount and targetDate must be set together";
  }
  if (hasAmount) {
    const n = Number(targetAmount);
    if (!Number.isFinite(n) || n <= 0) return "targetAmount must be a positive number";
  }
  if (hasDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate))) {
    return "targetDate must be a YYYY-MM-DD string";
  }
  return null;
}

async function userOwnsCategory(userId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return !!row;
}

// POST /api/pots — create a pot
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const { name, categoryId, targetAmount, targetDate } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const targetError = validateTarget(targetAmount, targetDate);
    if (targetError) {
      return NextResponse.json({ error: targetError }, { status: 400 });
    }
    if (categoryId && !(await userOwnsCategory(userId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    const id = crypto.randomUUID();
    await db.insert(transactionGroups).values({
      id,
      name,
      categoryId: categoryId || null,
      targetAmount: targetAmount != null ? Number(targetAmount) : null,
      targetDate: targetDate || null,
      fundedAmount: 0,
      userId,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  }, "Failed to create pot");
}

// PUT /api/pots — update a pot
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const { id, name, categoryId, targetAmount, targetDate, archived } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (categoryId && !(await userOwnsCategory(userId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    // If either target field is being touched, validate the pair.
    if (targetAmount !== undefined || targetDate !== undefined) {
      // Read existing values to validate the resulting pair, since the client
      // may only send one half of the change.
      const existing = await db
        .select({
          targetAmount: transactionGroups.targetAmount,
          targetDate: transactionGroups.targetDate,
        })
        .from(transactionGroups)
        .where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)))
        .get();
      if (!existing) {
        return apiError("api.potNotFound", 404);
      }
      const nextAmount = targetAmount === undefined ? existing.targetAmount : targetAmount;
      const nextDate = targetDate === undefined ? existing.targetDate : targetDate;
      const targetError = validateTarget(nextAmount, nextDate);
      if (targetError) {
        return NextResponse.json({ error: targetError }, { status: 400 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (targetAmount !== undefined) {
      updates.targetAmount = targetAmount === null ? null : Number(targetAmount);
    }
    if (targetDate !== undefined) {
      updates.targetDate = targetDate === null || targetDate === "" ? null : targetDate;
    }
    if (archived !== undefined) {
      updates.archivedAt = archived ? new Date().toISOString() : null;
    }
    // When a target is cleared, also reset funded so a future re-target starts fresh.
    if (
      (targetAmount === null || targetDate === null || targetDate === "") &&
      (targetAmount !== undefined || targetDate !== undefined)
    ) {
      updates.fundedAmount = 0;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(transactionGroups).set(updates).where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)));
    }

    return NextResponse.json({ success: true });
  }, "Failed to update pot");
}

// DELETE /api/pots?id=X — delete pot, sets group_id = NULL on member transactions
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Clear group_id on member transactions
    await db
      .update(transactions)
      .set({ groupId: null })
      .where(and(eq(transactions.groupId, id), eq(transactions.userId, userId)));

    // Delete the pot
    await db.delete(transactionGroups).where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)));

    return NextResponse.json({ success: true });
  }, "Failed to delete pot");
}
