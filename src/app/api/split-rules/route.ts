import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, splitRuleLines, splitRules } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { applySplitRulesToExisting, type SplitRuleMode } from "@/lib/split-rules";
import { isMatchField, isMatchType, isFiniteNumber, validatePattern } from "@/lib/validation";

const MIN_LINES = 2;
const MAX_LINES = 20;
// Percentages are user-entered decimals; 100.00 ± a cent's worth is "sums to 100".
const PERCENT_EPSILON = 0.01;

interface CleanLine {
  categoryId: string;
  percentage: number | null;
  amount: number | null;
  isRemainder: boolean;
  sortOrder: number;
}

function isMode(v: unknown): v is SplitRuleMode {
  return v === "percentage" || v === "fixed";
}

/**
 * Validate the lines of a split rule. Percentage mode: every line a positive
 * share, together 100, no remainder line. Fixed mode: exactly one remainder
 * line (no amount) and positive amounts everywhere else.
 */
function validateLines(input: unknown, mode: SplitRuleMode): CleanLine[] | null {
  if (!Array.isArray(input) || input.length < MIN_LINES || input.length > MAX_LINES) return null;

  const lines: CleanLine[] = [];
  let percentTotal = 0;
  let remainders = 0;

  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const { categoryId, percentage, amount, isRemainder } = raw as Record<string, unknown>;
    if (typeof categoryId !== "string" || !categoryId) return null;

    if (mode === "percentage") {
      if (isRemainder) return null;
      if (!isFiniteNumber(percentage) || percentage <= 0) return null;
      percentTotal += percentage;
      lines.push({ categoryId, percentage, amount: null, isRemainder: false, sortOrder: i });
      continue;
    }

    if (isRemainder) {
      remainders++;
      if (amount !== undefined && amount !== null) return null;
      lines.push({ categoryId, percentage: null, amount: null, isRemainder: true, sortOrder: i });
      continue;
    }
    if (!isFiniteNumber(amount) || amount <= 0) return null;
    lines.push({ categoryId, percentage: null, amount, isRemainder: false, sortOrder: i });
  }

  if (mode === "percentage" && Math.abs(percentTotal - 100) > PERCENT_EPSILON) return null;
  if (mode === "fixed" && remainders !== 1) return null;
  return lines;
}

async function ownsCategories(userId: string, lines: CleanLine[]): Promise<boolean> {
  const ids = [...new Set(lines.map((l) => l.categoryId))];
  const owned = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.id, ids), eq(categories.userId, userId)));
  return owned.length === ids.length;
}

async function linesFor(userId: string, ruleIds: string[]) {
  if (!ruleIds.length) return [];
  return db
    .select({
      id: splitRuleLines.id,
      ruleId: splitRuleLines.ruleId,
      categoryId: splitRuleLines.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      percentage: splitRuleLines.percentage,
      amount: splitRuleLines.amount,
      isRemainder: splitRuleLines.isRemainder,
      sortOrder: splitRuleLines.sortOrder,
    })
    .from(splitRuleLines)
    .leftJoin(
      categories,
      and(eq(splitRuleLines.categoryId, categories.id), eq(categories.userId, userId)),
    )
    .where(inArray(splitRuleLines.ruleId, ruleIds))
    .orderBy(splitRuleLines.sortOrder);
}

async function replaceLines(ruleId: string, lines: CleanLine[]) {
  await db.transaction(async (tx) => {
    // Scoped through ruleId — split_rule_lines has no user_id of its own.
    await tx.delete(splitRuleLines).where(eq(splitRuleLines.ruleId, ruleId));
    for (const line of lines) {
      await tx.insert(splitRuleLines).values({ id: crypto.randomUUID(), ruleId, ...line });
    }
  });
}

// GET /api/split-rules — list rules with their lines
export async function GET() {
  return withUser(async (userId) => {
    const rules = await db
      .select()
      .from(splitRules)
      .where(eq(splitRules.userId, userId))
      .orderBy(splitRules.createdAt);

    const lines = await linesFor(userId, rules.map((r) => r.id));
    return NextResponse.json(
      rules.map((rule) => ({
        ...rule,
        lines: lines.filter((l) => l.ruleId === rule.id),
      })),
    );
  }, "Failed to fetch split rules");
}

// POST /api/split-rules — create a rule, optionally applying it to existing transactions
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("api.splitRuleInvalidLines", 400);
    const { pattern, matchType, matchField, mode, lines, applyToExisting } = body;

    const validated = validatePattern(pattern);
    if (!validated.ok) return apiError(validated.error, 400, validated.vars);
    if (!isMode(mode)) return apiError("api.splitRuleInvalidLines", 400);

    const cleanLines = validateLines(lines, mode);
    if (!cleanLines || !(await ownsCategories(userId, cleanLines))) {
      return apiError("api.splitRuleInvalidLines", 400);
    }

    const id = crypto.randomUUID();
    await db.insert(splitRules).values({
      id,
      userId,
      pattern: validated.value,
      matchType: isMatchType(matchType) ? matchType : "contains",
      matchField: isMatchField(matchField) ? matchField : "both",
      mode,
      isActive: true,
    });
    await replaceLines(id, cleanLines);

    // No resplit on create: a row an OLDER rule already split belongs to that
    // rule, and this one has nothing of its own to redo yet.
    const applied = applyToExisting ? await applySplitRulesToExisting(userId, { ruleId: id }) : 0;
    return NextResponse.json({ success: true, ruleId: id, applied }, { status: 201 });
  }, "Failed to create split rule");
}

// PUT /api/split-rules — update a rule (lines are replaced wholesale)
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("api.splitRuleNotFound", 404);
    const { id, pattern, matchType, matchField, mode, lines, isActive, applyToExisting } = body;
    if (typeof id !== "string" || !id) return apiError("api.splitRuleNotFound", 404);

    const [existing] = await db
      .select()
      .from(splitRules)
      .where(and(eq(splitRules.id, id), eq(splitRules.userId, userId)));
    if (!existing) return apiError("api.splitRuleNotFound", 404);

    const updates: Record<string, unknown> = {};
    if (pattern !== undefined) {
      const validated = validatePattern(pattern);
      if (!validated.ok) return apiError(validated.error, 400, validated.vars);
      updates.pattern = validated.value;
    }
    if (matchType !== undefined) {
      if (!isMatchType(matchType)) return apiError("api.invalidMatchType", 400);
      updates.matchType = matchType;
    }
    if (matchField !== undefined) {
      if (!isMatchField(matchField)) return apiError("api.invalidMatchField", 400);
      updates.matchField = matchField;
    }
    if (mode !== undefined) {
      if (!isMode(mode)) return apiError("api.splitRuleInvalidLines", 400);
      updates.mode = mode;
    }
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    // Lines must be revalidated against the mode as it will be stored, and a
    // mode change without new lines would leave the old lines meaningless.
    const effectiveMode: SplitRuleMode = isMode(mode) ? mode : existing.mode;
    let cleanLines: CleanLine[] | null = null;
    if (lines !== undefined || effectiveMode !== existing.mode) {
      cleanLines = validateLines(lines, effectiveMode);
      if (!cleanLines || !(await ownsCategories(userId, cleanLines))) {
        return apiError("api.splitRuleInvalidLines", 400);
      }
    }

    if (Object.keys(updates).length) {
      await db
        .update(splitRules)
        .set(updates)
        .where(and(eq(splitRules.id, id), eq(splitRules.userId, userId)));
    }
    if (cleanLines) await replaceLines(id, cleanLines);

    // resplit: on an edit, "apply to existing" has to redo the rows this rule
    // already split, or new percentages never reach them.
    const applied = applyToExisting
      ? await applySplitRulesToExisting(userId, { ruleId: id, resplit: true })
      : 0;
    return NextResponse.json({ ...existing, ...updates, applied });
  }, "Failed to update split rule");
}

// DELETE /api/split-rules?id=… — delete a rule and its lines
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return apiError("api.splitRuleNotFound", 404);

    // Ownership first: the line delete can only be scoped by ruleId, so it must
    // never run for a rule id belonging to someone else.
    const [owned] = await db
      .select({ id: splitRules.id })
      .from(splitRules)
      .where(and(eq(splitRules.id, id), eq(splitRules.userId, userId)));
    if (!owned) return apiError("api.splitRuleNotFound", 404);

    // Both in one transaction. The schema declares ON DELETE cascade on
    // split_rule_lines.rule_id, but hosted libsql doesn't guarantee
    // foreign_keys=ON, so the lines are removed explicitly — and failing
    // between the two statements would strand them.
    await db.transaction(async (tx) => {
      await tx.delete(splitRuleLines).where(eq(splitRuleLines.ruleId, id));
      await tx.delete(splitRules).where(and(eq(splitRules.id, id), eq(splitRules.userId, userId)));
    });
    return NextResponse.json({ success: true });
  }, "Failed to delete split rule");
}
