import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  budgetMonthTargets,
  budgets,
  budgetSubLines,
  categories,
  categoryRules,
  recurringTransactions,
  transactionGroups,
  transactions,
} from "@/db/schema";
import { eq, sql, and, asc, count, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";

// GET /api/categories — list all categories with transaction counts
export async function GET() {
  return withUser(async (userId) => {
    const allCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));

    const categoriesWithCounts = await Promise.all(
      allCategories.map(async (cat) => {
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(transactions)
          .where(and(eq(transactions.categoryId, cat.id), eq(transactions.userId, userId)));

        const rulesResult = await db
          .select()
          .from(categoryRules)
          .where(and(eq(categoryRules.categoryId, cat.id), eq(categoryRules.userId, userId)));

        return {
          ...cat,
          transactionCount: countResult[0]?.count || 0,
          rules: rulesResult,
        };
      })
    );

    return NextResponse.json(categoriesWithCounts);
  }, "Failed to fetch categories");
}

// POST /api/categories — create a new category
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { name, icon, color } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    // New categories land at the bottom of the user's order.
    const [{ total }] = await db.select({ total: count() }).from(categories).where(eq(categories.userId, userId));

    await db.insert(categories).values({
      id,
      userId,
      name,
      icon: icon || null,
      color: color || "#94a3b8",
      sortOrder: total,
      createdAt: new Date().toISOString(),
    });

    const [newCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    logDataEvent({ userId, action: "category_create", targetId: id, targetType: "category", details: { name } });

    return NextResponse.json(newCategory, { status: 201 });
  }, "Failed to create category");
}

// PUT /api/categories — update a category
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, icon, color } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)));

    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const updateSet: {
      name?: string;
      icon?: string | null;
      color?: string | null;
    } = {};
    if (name !== undefined) updateSet.name = name;
    if (icon !== undefined) updateSet.icon = icon;
    if (color !== undefined) updateSet.color = color;

    if (Object.keys(updateSet).length > 0) {
      await db
        .update(categories)
        .set(updateSet)
        .where(and(eq(categories.id, id), eq(categories.userId, userId)));
    }

    const [updated] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)));

    logDataEvent({
      userId,
      action: "category_update",
      targetId: id,
      targetType: "category",
      details: { name },
    });

    return NextResponse.json(updated);
  }, "Failed to update category");
}

// PATCH /api/categories — reorder categories
export async function PATCH(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { orderedIds } = body as { orderedIds: string[] };

    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { error: "orderedIds array is required" },
        { status: 400 }
      );
    }

    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(categories)
        .set({ sortOrder: i })
        .where(and(eq(categories.id, orderedIds[i]), eq(categories.userId, userId)));
    }

    return NextResponse.json({ success: true });
  }, "Failed to reorder categories");
}

// DELETE /api/categories — delete one category (?id=x) or several (?id=x&id=y)
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const ids = searchParams.getAll("id");

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    const doomed = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(inArray(categories.id, ids), eq(categories.userId, userId)));

    const doomedIds = doomed.map((cat) => cat.id);

    if (doomedIds.length > 0) {
      // Drop the FK but keep the name as plain text, so history stays readable.
      for (const cat of doomed) {
        await db
          .update(transactions)
          .set({ categoryId: null, categoryLabel: cat.name, categorySource: null })
          .where(and(eq(transactions.categoryId, cat.id), eq(transactions.userId, userId)));
      }

      await db
        .update(recurringTransactions)
        .set({ categoryId: null })
        .where(
          and(
            inArray(recurringTransactions.categoryId, doomedIds),
            eq(recurringTransactions.userId, userId)
          )
        );

      await db
        .update(transactionGroups)
        .set({ categoryId: null })
        .where(
          and(
            inArray(transactionGroups.categoryId, doomedIds),
            eq(transactionGroups.userId, userId)
          )
        );

      await db.delete(budgetSubLines).where(
        and(
          eq(budgetSubLines.userId, userId),
          inArray(
            budgetSubLines.allocationId,
            db
              .select({ id: budgets.id })
              .from(budgets)
              .where(
                and(
                  inArray(budgets.categoryId, doomedIds),
                  eq(budgets.userId, userId)
                )
              )
          )
        )
      );

      await db
        .delete(budgets)
        .where(
          and(
            inArray(budgets.categoryId, doomedIds),
            eq(budgets.userId, userId)
          )
        );

      await db
        .delete(budgetMonthTargets)
        .where(
          and(
            inArray(budgetMonthTargets.categoryId, doomedIds),
            eq(budgetMonthTargets.userId, userId)
          )
        );

      await db
        .delete(categoryRules)
        .where(
          and(
            inArray(categoryRules.categoryId, doomedIds),
            eq(categoryRules.userId, userId)
          )
        );
    }

    const deleted = await db
      .delete(categories)
      .where(and(inArray(categories.id, ids), eq(categories.userId, userId)))
      .returning({ id: categories.id });

    for (const { id } of deleted) {
      logDataEvent({ userId, action: "category_delete", targetId: id, targetType: "category" });
    }

    return NextResponse.json({ success: true, deleted: deleted.length });
  }, "Failed to delete categories");
}
