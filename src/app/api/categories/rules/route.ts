import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { categoryRules, categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { validatePattern, isMatchType, isMatchField } from "@/lib/validation";

async function userOwnsCategory(userId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return !!row;
}
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
        matchField: categoryRules.matchField,
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
    const { pattern, categoryId, matchType, matchField, applyToExisting } = body;

    if (!pattern || !categoryId) {
      return apiError("api.patternAndCategoryRequired", 400);
    }

    const validated = validatePattern(pattern);
    if (!validated.ok) {
      return apiError(validated.error, 400, validated.vars);
    }
    if (!(await userOwnsCategory(userId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }
    const cleanMatchType = isMatchType(matchType) ? matchType : "contains";
    const cleanMatchField = isMatchField(matchField) ? matchField : "both";

    const id = crypto.randomUUID();
    await db.insert(categoryRules).values({
      id,
      pattern: validated.value,
      categoryId,
      matchType: cleanMatchType,
      matchField: cleanMatchField,
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
        matchType: cleanMatchType,
        matchField: cleanMatchField,
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
    const { id, pattern, categoryId, matchType, matchField, isActive, applyToExisting } = body;

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
        return apiError(validated.error, 400, validated.vars);
      }
      validatedPattern = validated.value;
    }

    if (matchType !== undefined && !isMatchType(matchType)) {
      return apiError("api.invalidMatchType", 400);
    }
    if (matchField !== undefined && !isMatchField(matchField)) {
      return apiError("api.invalidMatchField", 400);
    }
    if (categoryId !== undefined && !(await userOwnsCategory(userId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    const updates: Record<string, unknown> = {};
    if (validatedPattern !== undefined) updates.pattern = validatedPattern;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (matchType !== undefined) updates.matchType = matchType;
    if (matchField !== undefined) updates.matchField = matchField;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    await db
      .update(categoryRules)
      .set(updates)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));

    // Re-read the stored rule so applyToExisting uses the rule as saved —
    // fields the client didn't resend (e.g. matchType) must not fall back
    // to defaults.
    const [updated] = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));

    if (!updated) {
      return apiError("api.ruleNotFound", 404);
    }

    let applied = 0;
    if (applyToExisting) {
      applied = await applyRuleToTransactions({
        pattern: updated.pattern,
        categoryId: updated.categoryId,
        matchType: updated.matchType,
        matchField: updated.matchField,
        userId,
      });
    }

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
