import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { categories, categoryRules, transactions } from "@/db/schema";
import { eq, sql, and, asc, count } from "drizzle-orm";
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
      return apiError("api.nameRequired", 400);
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
      return apiError("api.categoryNotFound", 404);
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

// DELETE /api/categories — delete a category
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    // Unset category on remaining transactions
    await db
      .update(transactions)
      .set({ categoryId: null })
      .where(and(eq(transactions.categoryId, id), eq(transactions.userId, userId)));

    await db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)));

    logDataEvent({ userId, action: "category_delete", targetId: id, targetType: "category" });

    return NextResponse.json({ success: true });
  }, "Failed to delete category");
}
