import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { validatePattern } from "@/lib/validation";
import { applyRuleToTransactions } from "@/lib/apply-rule";

// GET /api/categories/rules — list all rules
export async function GET() {
  return withUser(async (userId) => {
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
  }, "Failed to fetch rules");
}

// POST /api/categories/rules — create a rule and optionally apply to existing transactions
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
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
      applied = await applyRuleToTransactions({
        pattern: validated.value,
        categoryId,
        matchType: matchType || "contains",
        userId,
      });
    }

    return NextResponse.json({ success: true, ruleId: id, applied }, { status: 201 });
  }, "Failed to create rule");
}

// PUT /api/categories/rules — update an existing rule
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
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
      applied = await applyRuleToTransactions({
        pattern: validatedPattern,
        categoryId,
        matchType: matchType || "contains",
        userId,
      });
    }

    const [updated] = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));

    return NextResponse.json({ ...updated, applied });
  }, "Failed to update rule");
}

// DELETE /api/categories/rules — delete a rule
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
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
  }, "Failed to delete rule");
}
