import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  categories,
  categoryRules,
  transactions,
  budgets,
  recurringTransactions,
} from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";

type CategoryKind = "spending" | "reserved";

// Upsert (or delete, when amount is 0) the optional monthly target for a
// reserved category. The target is stored in the existing `budgets` table —
// reserved-kind budgets are interpreted as planned reservations rather than
// spending limits.
async function setReservedTarget(
  userId: string,
  categoryId: string,
  amount: number
) {
  const [existing] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        eq(budgets.categoryId, categoryId),
        eq(budgets.isActive, true),
        eq(budgets.status, "active")
      )
    )
    .limit(1);

  if (amount <= 0) {
    if (existing) {
      await db
        .delete(budgets)
        .where(and(eq(budgets.id, existing.id), eq(budgets.userId, userId)));
    }
    return;
  }

  if (existing) {
    await db
      .update(budgets)
      .set({ amount, period: "monthly", source: "manual" })
      .where(and(eq(budgets.id, existing.id), eq(budgets.userId, userId)));
  } else {
    await db.insert(budgets).values({
      id: crypto.randomUUID(),
      userId,
      categoryId,
      amount,
      period: "monthly",
      isActive: true,
      status: "active",
      source: "manual",
      createdAt: new Date().toISOString(),
    });
  }
}

// Sync transactions.type and recurringTransactions.type to match the
// category's kind. Reserved categories carry type='reserved'; spending
// categories restore type from amount sign (negative → expense, positive →
// income). Internal transfers and reimbursements keep their existing type —
// those are categorized via separate flows.
async function syncTransactionTypeForCategory(
  userId: string,
  categoryId: string,
  newKind: CategoryKind
) {
  if (newKind === "reserved") {
    await db
      .update(transactions)
      .set({ type: "reserved" })
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.categoryId, categoryId),
          sql`${transactions.type} IN ('income', 'expense')`
        )
      );

    await db
      .update(recurringTransactions)
      .set({ type: "reserved" })
      .where(
        and(
          eq(recurringTransactions.userId, userId),
          eq(recurringTransactions.categoryId, categoryId),
          sql`${recurringTransactions.type} IN ('income', 'expense')`
        )
      );
    return;
  }

  // newKind === 'spending': restore type from amount sign.
  await db.run(sql`
    UPDATE transactions
       SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END
     WHERE user_id = ${userId}
       AND category_id = ${categoryId}
       AND type = 'reserved'
  `);

  await db.run(sql`
    UPDATE recurring_transactions
       SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END
     WHERE user_id = ${userId}
       AND category_id = ${categoryId}
       AND type = 'reserved'
  `);
}

// GET /api/categories — list all categories with transaction counts
export async function GET() {
  return withUser(async (userId) => {
    const allCategories = await db.select().from(categories).where(eq(categories.userId, userId));

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

// POST /api/categories — create a new category. The `kind` field marks it
// as 'spending' (default) or 'reserved' (savings/set-aside; transactions in
// it carry type='reserved' and reduce Free to Spend without counting as
// discretionary spend). Reserved categories may optionally carry a monthly
// `budgetAmount` target — when set, it acts as a planned reservation that
// counts against Free to Spend and available-to-allocate even before
// transactions land.
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { name, icon, color } = body;
    const kind: CategoryKind = body.kind === "reserved" ? "reserved" : "spending";
    const budgetAmount: number | undefined =
      typeof body.budgetAmount === "number" && body.budgetAmount > 0
        ? body.budgetAmount
        : undefined;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(categories).values({
      id,
      userId,
      name,
      icon: icon || null,
      color: color || "#94a3b8",
      kind,
      createdAt: new Date().toISOString(),
    });

    if (kind === "reserved" && budgetAmount !== undefined) {
      await setReservedTarget(userId, id, budgetAmount);
    }

    const [newCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    logDataEvent({ userId, action: "category_create", targetId: id, targetType: "category", details: { name, kind } });

    return NextResponse.json(newCategory, { status: 201 });
  }, "Failed to create category");
}

// PUT /api/categories — update a category. Allows flipping `kind`. Flipping
// to/from 'reserved' syncs all existing transactions in the category between
// 'reserved' and 'expense'/'income' (derived from amount sign). When
// `budgetAmount` is provided on a reserved category, it sets/updates the
// optional monthly target. Pass 0 to clear the target.
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, icon, color } = body;
    const kindUpdate: CategoryKind | undefined =
      body.kind === "reserved" || body.kind === "spending" ? body.kind : undefined;
    const budgetAmountProvided = typeof body.budgetAmount === "number";
    const budgetAmount: number = budgetAmountProvided ? body.budgetAmount : 0;

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
      kind?: CategoryKind;
    } = {};
    if (name !== undefined) updateSet.name = name;
    if (icon !== undefined) updateSet.icon = icon;
    if (color !== undefined) updateSet.color = color;
    if (kindUpdate !== undefined) updateSet.kind = kindUpdate;

    if (Object.keys(updateSet).length > 0) {
      await db
        .update(categories)
        .set(updateSet)
        .where(and(eq(categories.id, id), eq(categories.userId, userId)));
    }

    if (kindUpdate !== undefined && kindUpdate !== existing.kind) {
      await syncTransactionTypeForCategory(userId, id, kindUpdate);
    }

    // Apply target updates only on reserved categories. If the category was
    // (or just became) reserved, an explicit budgetAmount sets the target;
    // budgetAmount=0 clears it.
    const effectiveKind = kindUpdate ?? existing.kind;
    if (effectiveKind === "reserved" && budgetAmountProvided) {
      await setReservedTarget(userId, id, budgetAmount);
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
      details: { name, kind: kindUpdate },
    });

    return NextResponse.json(updated);
  }, "Failed to update category");
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

    // Reserved-category transactions carry type='reserved'; on category
    // deletion we drop the reservation and restore type from amount sign.
    await db.run(sql`
      UPDATE transactions
         SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END,
             category_id = NULL
       WHERE user_id = ${userId}
         AND category_id = ${id}
         AND type = 'reserved'
    `);
    await db.run(sql`
      UPDATE recurring_transactions
         SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END,
             category_id = NULL
       WHERE user_id = ${userId}
         AND category_id = ${id}
         AND type = 'reserved'
    `);

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
