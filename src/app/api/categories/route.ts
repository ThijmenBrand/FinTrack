import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { categories, categoryRules, transactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// GET /api/categories — list all categories with transaction counts
export async function GET() {
  try {
    const allCategories = await db.select().from(categories);

    const categoriesWithCounts = await Promise.all(
      allCategories.map(async (cat) => {
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(transactions)
          .where(eq(transactions.categoryId, cat.id));

        const rulesResult = await db
          .select()
          .from(categoryRules)
          .where(eq(categoryRules.categoryId, cat.id));

        return {
          ...cat,
          transactionCount: countResult[0]?.count || 0,
          rules: rulesResult,
        };
      })
    );

    return NextResponse.json(categoriesWithCounts);
  } catch (error) {
    console.error("Failed to fetch categories:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

// POST /api/categories — create a new category
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, icon, color } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(categories).values({
      id,
      name,
      icon: icon || null,
      color: color || "#94a3b8",
      createdAt: new Date().toISOString(),
    });

    const [newCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    return NextResponse.json(newCategory, { status: 201 });
  } catch (error) {
    console.error("Failed to create category:", error);
    return NextResponse.json(
      { error: "Failed to create category" },
      { status: 500 }
    );
  }
}

// PUT /api/categories — update a category
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, icon, color } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    await db
      .update(categories)
      .set({ name, icon, color })
      .where(eq(categories.id, id));

    const [updated] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update category:", error);
    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 }
    );
  }
}

// DELETE /api/categories — delete a category
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    // Unset category on transactions before deleting
    await db
      .update(transactions)
      .set({ categoryId: null })
      .where(eq(transactions.categoryId, id));

    await db.delete(categories).where(eq(categories.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete category:", error);
    return NextResponse.json(
      { error: "Failed to delete category" },
      { status: 500 }
    );
  }
}
