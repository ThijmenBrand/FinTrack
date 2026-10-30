import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactionGroups } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { treeToInput, validatePotBudget } from "@/lib/pot-budget";
import { isIsoDate } from "@/lib/validation";
import {
  budgetCategoryIds,
  loadPotTrees,
  replacePotBudget,
  userOwnsCategories,
} from "@/lib/pot-budget-db";
import type { PotBudgetTree } from "@/types/api";

type Params = { params: Promise<{ id: string }> };

async function loadPot(reader: Pick<typeof db, "select">, userId: string, id: string) {
  return reader
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
    const pot = await loadPot(db, userId, id);
    if (!pot) return apiError("api.potNotFound", 404);
    const trees = await loadPotTrees(db, userId, [id]);
    const body: PotBudgetTree = treeToInput(pot.targetAmount, trees.get(id) ?? []);
    return NextResponse.json(body);
  }, "Failed to fetch pot budget");
}

// PUT /api/pots/[id]/budget — replace the whole budget: { total, lines,
// targetDate? }.
// The total is the pot's targetAmount, so total and lines move together in one
// transaction and can never be saved out of step. { total: null, lines: [] }
// removes the budget.
export async function PUT(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);

    // Read, check and write in one transaction: the pot's date decides whether
    // the total may be cleared, so it must be the date the write lands on.
    const outcome = await db.transaction(async (tx) => {
      const pot = await loadPot(tx, userId, id);
      if (!pot) return apiError("api.potNotFound", 404);

      // The date the total is saved toward rides along, so the editor saves
      // the whole plan at once. Absent = unchanged; null or "" clears it.
      const rawDate = body && typeof body === "object" ? (body as Record<string, unknown>).targetDate : undefined;
      let targetDate = pot.targetDate;
      if (rawDate !== undefined) {
        if (rawDate === null || rawDate === "") targetDate = null;
        else if (isIsoDate(rawDate)) targetDate = rawDate;
        else return apiError("pots.budget.err.dateInvalid", 400, undefined, { code: "pots.budget.err.dateInvalid" });
      }

      const result = validatePotBudget(body, { hasTargetDate: !!targetDate });
      if (!result.ok) {
        return apiError(result.error, 400, undefined, {
          code: result.error,
          ...(result.categoryId ? { categoryId: result.categoryId } : {}),
        });
      }
      if (!(await userOwnsCategories(tx, userId, budgetCategoryIds(result.value)))) {
        return apiError("api.categoryNotFound", 404);
      }

      await replacePotBudget(tx, userId, id, result.value, {
        targetDate,
        // No date, nothing being saved toward: what was set aside starts over
        // if one is set again.
        resetFunding: !!pot.targetDate && !targetDate,
      });
      return { total: result.value.total, targetDate, lineCount: result.value.lines.length };
    });
    if (outcome instanceof Response) return outcome;

    logDataEvent({
      userId,
      action: "pot.budget_update",
      targetId: id,
      targetType: "pot",
      details: outcome,
    });

    return NextResponse.json({ success: true });
  }, "Failed to save pot budget");
}
