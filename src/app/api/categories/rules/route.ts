import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, transactions, categories } from "@/db/schema";
import { eq, and, like, sql } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { validatePattern } from "@/lib/validation";

// GET /api/categories/rules — list all rules
export async function GET() {
  try {
    const userId = await getUserId();

    const rules = await db
      .select({
        id: categoryRules.id,
        pattern: categoryRules.pattern,
        categoryId: categoryRules.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        matchType: categoryRules.matchType,
        isActive: categoryRules.isActive,
        createdAt: categoryRules.createdAt,
      })
      .from(categoryRules)
      .leftJoin(categories, eq(categoryRules.categoryId, categories.id))
      .where(eq(categoryRules.userId, userId));

    return NextResponse.json(rules);
  } catch (error) {
    console.error("Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules" },
      { status: 500 }
    );
  }
}

// POST /api/categories/rules — create a rule and optionally apply to existing transactions
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const { pattern, categoryId, matchType, applyToExisting } = body;

    if (!pattern || !categoryId) {
      return NextResponse.json(
        { error: "Pattern and categoryId are required" },
        { status: 400 }
      );
    }

    const validated = validatePattern(pattern);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await db.insert(categoryRules).values({
      id,
      pattern: validated.value,
      categoryId,
      matchType: matchType || "contains",
      isActive: true,
      userId,
      createdAt: new Date().toISOString(),
    });

    let applied = 0;

    // Optionally apply rule to all existing uncategorized transactions
    if (applyToExisting) {
      applied = await applyRuleToTransactions(validated.value, categoryId, matchType || "contains", userId);
    }

    return NextResponse.json({ success: true, ruleId: id, applied }, { status: 201 });
  } catch (error) {
    console.error("Failed to create rule:", error);
    return NextResponse.json(
      { error: "Failed to create rule" },
      { status: 500 }
    );
  }
}

// PUT /api/categories/rules — update an existing rule
export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const { id, pattern, categoryId, matchType, isActive, applyToExisting } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Rule ID is required" },
        { status: 400 }
      );
    }

    let validatedPattern: string | undefined;
    if (pattern !== undefined) {
      const validated = validatePattern(pattern);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      validatedPattern = validated.value;
    }

    const updates: Record<string, unknown> = {};
    if (validatedPattern !== undefined) updates.pattern = validatedPattern;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (matchType !== undefined) updates.matchType = matchType;
    if (isActive !== undefined) updates.isActive = isActive;

    await db
      .update(categoryRules)
      .set(updates)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));

    let applied = 0;
    if (applyToExisting && validatedPattern && categoryId) {
      applied = await applyRuleToTransactions(
        validatedPattern,
        categoryId,
        matchType || "contains",
        userId
      );
    }

    const [updated] = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));

    return NextResponse.json({ ...updated, applied });
  } catch (error) {
    console.error("Failed to update rule:", error);
    return NextResponse.json(
      { error: "Failed to update rule" },
      { status: 500 }
    );
  }
}

// DELETE /api/categories/rules — delete a rule
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Rule ID is required" },
        { status: 400 }
      );
    }

    await db.delete(categoryRules).where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete rule:", error);
    return NextResponse.json(
      { error: "Failed to delete rule" },
      { status: 500 }
    );
  }
}

/**
 * Apply a categorization rule to existing transactions that match the pattern
 * and don't already have a category.
 */
async function applyRuleToTransactions(
  pattern: string,
  categoryId: string,
  matchType: string,
  userId: string
): Promise<number> {
  // Build the appropriate SQL pattern
  let sqlPattern: string;
  switch (matchType) {
    case "exact":
      sqlPattern = pattern;
      break;
    case "starts_with":
      sqlPattern = `${pattern}%`;
      break;
    case "contains":
    default:
      sqlPattern = `%${pattern}%`;
      break;
  }

  // Update transactions that match the pattern and have no category
  const condition =
    matchType === "exact"
      ? sql`LOWER(${transactions.description}) = LOWER(${pattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId}`
      : sql`LOWER(${transactions.description}) LIKE LOWER(${sqlPattern}) AND ${transactions.categoryId} IS NULL AND ${transactions.userId} = ${userId}`;

  const result = await db
    .update(transactions)
    .set({ categoryId })
    .where(condition);

  return result.rowsAffected;
}
