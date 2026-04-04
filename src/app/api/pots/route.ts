import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactionGroups, transactions, categories } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// GET /api/pots — list all pots with net amount, transaction count, category info
export async function GET() {
  try {
    const pots = await db
      .select({
        id: transactionGroups.id,
        name: transactionGroups.name,
        categoryId: transactionGroups.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        createdAt: transactionGroups.createdAt,
        netAmount: sql<number>`COALESCE((
          SELECT SUM(t.amount) FROM transactions t WHERE t.group_id = ${transactionGroups.id}
        ), 0)`,
        transactionCount: sql<number>`(
          SELECT COUNT(*) FROM transactions t WHERE t.group_id = ${transactionGroups.id}
        )`,
      })
      .from(transactionGroups)
      .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
      .orderBy(sql`${transactionGroups.createdAt} DESC`);

    return NextResponse.json(pots);
  } catch (error) {
    console.error("Failed to fetch pots:", error);
    return NextResponse.json({ error: "Failed to fetch pots" }, { status: 500 });
  }
}

// POST /api/pots — create a pot
export async function POST(request: NextRequest) {
  try {
    const { name, categoryId } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await db.insert(transactionGroups).values({
      id,
      name,
      categoryId: categoryId || null,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create pot:", error);
    return NextResponse.json({ error: "Failed to create pot" }, { status: 500 });
  }
}

// PUT /api/pots — update a pot
export async function PUT(request: NextRequest) {
  try {
    const { id, name, categoryId } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (categoryId !== undefined) updates.categoryId = categoryId;

    if (Object.keys(updates).length > 0) {
      await db.update(transactionGroups).set(updates).where(eq(transactionGroups.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update pot:", error);
    return NextResponse.json({ error: "Failed to update pot" }, { status: 500 });
  }
}

// DELETE /api/pots?id=X — delete pot, sets group_id = NULL on member transactions
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Clear group_id on member transactions
    await db
      .update(transactions)
      .set({ groupId: null })
      .where(eq(transactions.groupId, id));

    // Delete the pot
    await db.delete(transactionGroups).where(eq(transactionGroups.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete pot:", error);
    return NextResponse.json({ error: "Failed to delete pot" }, { status: 500 });
  }
}
