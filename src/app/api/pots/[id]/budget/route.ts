import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactionGroups } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { treeToInput, validatePotBudget } from "@/lib/pot-budget";
import {
  budgetCategoryIds,
  loadPotTrees,
  replacePotBudget,
  userOwnsCategories,
} from "@/lib/pot-budget-db";
import type { PotBudgetTree } from "@/types/api";

type Params = { params: Promise<{ id: string }> };

async function loadPot(userId: string, id: string) {
  return db
    .select({ targetAmount: transactionGroups.targetAmount, targetDate: transactionGroups.targetDate })
    .from(transactionGroups)
    .where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)))
    .get();
}

// GET /api/pots/[id]/budget — the pot's budget as written: total + line tree.
// No spend; the editor's "copy lines from…" reads it.
export async function GET(_request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const pot = await loadPot(userId, id);
    if (!pot) return apiError("api.potNotFound", 404);
    const trees = await loadPotTrees(db, userId, [id]);
    const body: PotBudgetTree = treeToInput(pot.targetAmount, trees.get(id) ?? []);
    return NextResponse.json(body);
  }, "Failed to fetch pot budget");
}

// PUT /api/pots/[id]/budget — replace the whole budget: { total, lines }.
// The total is the pot's targetAmount, so total and lines move together in one
// transaction and can never be saved out of step. { total: null, lines: [] }
// removes the budget.
export async function PUT(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const pot = await loadPot(userId, id);
    if (!pot) return apiError("api.potNotFound", 404);

    const body = await request.json().catch(() => null);
    const result = validatePotBudget(body, { hasTargetDate: !!pot.targetDate });
    if (!result.ok) {
      return apiError(result.error, 400, undefined, {
        code: result.error,
        ...(result.categoryId ? { categoryId: result.categoryId } : {}),
      });
    }
    if (!(await userOwnsCategories(db, userId, budgetCategoryIds(result.value)))) {
      return apiError("api.categoryNotFound", 404);
    }

    await db.transaction((tx) => replacePotBudget(tx, userId, id, result.value));

    logDataEvent({
      userId,
      action: "pot.budget_update",
      targetId: id,
      targetType: "pot",
      details: {
        total: result.value.total,
        lineCount: result.value.lines.length,
      },
    });

    return NextResponse.json({ success: true });
  }, "Failed to save pot budget");
}
