import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactionGroups, transactions, categories } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { MAX_POT_AMOUNT, toCents, validatePotBudget } from "@/lib/pot-budget";
import {
  budgetCategoryIds,
  deletePotBudgetLines,
  replacePotBudget,
  topLevelPlannedCents,
  userOwnsCategories,
} from "@/lib/pot-budget-db";

// GET /api/pots — list all pots with net amount, transaction count, category info
export async function GET() {
  return withUser(async (userId) => {
    const pots = await db
      .select({
        id: transactionGroups.id,
        name: transactionGroups.name,
        categoryId: transactionGroups.categoryId,
        categoryName: categories.name,
        categoryColor: categories.color,
        targetAmount: transactionGroups.targetAmount,
        targetDate: transactionGroups.targetDate,
        fundedAmount: transactionGroups.fundedAmount,
        archivedAt: transactionGroups.archivedAt,
        createdAt: transactionGroups.createdAt,
        netAmount: sql<number>`COALESCE((
          SELECT SUM(t.amount) FROM transactions t WHERE t.group_id = ${transactionGroups.id} AND t.user_id = ${userId}
        ), 0)`,
        transactionCount: sql<number>`(
          SELECT COUNT(*) FROM transactions t WHERE t.group_id = ${transactionGroups.id} AND t.user_id = ${userId}
        )`,
        // Spending as budgets count it (see pot-budget-db.loadPotCategoryNets):
        // unlike netAmount, the transfers that fund the pot aren't spending.
        spentAmount: sql<number>`MAX(-COALESCE((
          SELECT SUM(t.amount) FROM transactions t
          WHERE t.group_id = ${transactionGroups.id} AND t.user_id = ${userId}
            AND t.type != 'internal_transfer' AND t.is_split_parent = 0
        ), 0), 0)`,
        lineCount: sql<number>`(
          SELECT COUNT(*) FROM pot_budget_lines l
          WHERE l.pot_id = ${transactionGroups.id} AND l.user_id = ${userId} AND l.parent_id IS NULL
        )`,
      })
      .from(transactionGroups)
      .leftJoin(categories, eq(transactionGroups.categoryId, categories.id))
      .where(eq(transactionGroups.userId, userId))
      .orderBy(sql`${transactionGroups.createdAt} DESC`);

    // Cents, like the details view: a float sum shouldn't read as a mismatch.
    return NextResponse.json(pots.map((p) => ({ ...p, spentAmount: toCents(Number(p.spentAmount)) / 100 })));
  }, "Failed to fetch pots");
}

/** A target amount as stored: rounded to the cent, like every budget amount. */
const toAmount = (v: unknown) => toCents(Number(v)) / 100;

// Validate a target. The amount is the pot's budget total and can stand alone;
// a date makes it a savings target ("spike"), which needs an amount to save to.
function validateTarget(targetAmount: unknown, targetDate: unknown): string | null {
  const hasAmount = targetAmount !== undefined && targetAmount !== null;
  const hasDate = targetDate !== undefined && targetDate !== null && targetDate !== "";
  if (hasDate && !hasAmount) {
    return "targetDate requires a targetAmount";
  }
  if (hasAmount) {
    const n = toAmount(targetAmount);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_POT_AMOUNT) {
      return "targetAmount must be a positive number";
    }
  }
  if (hasDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate))) {
    return "targetDate must be a YYYY-MM-DD string";
  }
  return null;
}

async function userOwnsCategory(userId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return !!row;
}

// POST /api/pots — create a pot
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const { name, categoryId, targetAmount, targetDate, lines } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const targetError = validateTarget(targetAmount, targetDate);
    if (targetError) {
      return NextResponse.json({ error: targetError }, { status: 400 });
    }
    if (categoryId && !(await userOwnsCategory(userId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    // Optional budget lines, so the create dialog can save pot and budget in
    // one request — a pot without its budget is never left behind.
    let budget = null;
    if (lines !== undefined) {
      const result = validatePotBudget(
        { total: targetAmount != null ? toAmount(targetAmount) : null, lines },
        { hasTargetDate: !!targetDate },
      );
      if (!result.ok) return apiError(result.error, 400, undefined, { code: result.error });
      if (!(await userOwnsCategories(db, userId, budgetCategoryIds(result.value)))) {
        return apiError("api.categoryNotFound", 404);
      }
      budget = result.value;
    }

    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(transactionGroups).values({
        id,
        name,
        categoryId: categoryId || null,
        targetAmount: targetAmount != null ? toAmount(targetAmount) : null,
        targetDate: targetDate || null,
        fundedAmount: 0,
        userId,
        createdAt: new Date().toISOString(),
      });
      if (budget) await replacePotBudget(tx, userId, id, budget);
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  }, "Failed to create pot");
}

// PUT /api/pots — update a pot
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const { id, name, categoryId, targetAmount, targetDate, archived } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (categoryId && !(await userOwnsCategory(userId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (categoryId !== undefined) updates.categoryId = categoryId;
    if (targetAmount !== undefined) {
      updates.targetAmount = targetAmount === null ? null : toAmount(targetAmount);
    }
    if (targetDate !== undefined) {
      updates.targetDate = targetDate === null || targetDate === "" ? null : targetDate;
    }
    if (archived !== undefined) {
      updates.archivedAt = archived ? new Date().toISOString() : null;
    }
    // When a target is cleared, also reset funded so a future re-target starts fresh.
    if (
      (targetAmount === null || targetDate === null || targetDate === "") &&
      (targetAmount !== undefined || targetDate !== undefined)
    ) {
      updates.fundedAmount = 0;
    }

    // Check and write in one transaction, so a budget saved in between can't
    // leave the total out of step with its lines.
    const rejected = await db.transaction(async (tx) => {
      // If either target field is being touched, validate the pair.
      if (targetAmount !== undefined || targetDate !== undefined) {
        // Read existing values to validate the resulting pair, since the client
        // may only send one half of the change.
        const existing = await tx
          .select({
            targetAmount: transactionGroups.targetAmount,
            targetDate: transactionGroups.targetDate,
          })
          .from(transactionGroups)
          .where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)))
          .get();
        if (!existing) {
          return apiError("api.potNotFound", 404);
        }
        const nextAmount = targetAmount === undefined ? existing.targetAmount : targetAmount;
        const nextDate = targetDate === undefined ? existing.targetDate : targetDate;
        const targetError = validateTarget(nextAmount, nextDate);
        if (targetError) {
          return NextResponse.json({ error: targetError }, { status: 400 });
        }
        // The amount is also the budget total: with lines planned, it can only
        // change together with them (PUT /api/pots/[id]/budget).
        if (targetAmount !== undefined) {
          const planned = await topLevelPlannedCents(tx, userId, id);
          if (planned !== null && (targetAmount === null || toCents(Number(targetAmount)) !== planned)) {
            return apiError("pots.budget.err.sumMismatch", 409, undefined, {
              code: "pots.budget.err.sumMismatch",
            });
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(transactionGroups).set(updates).where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)));
      }
      return null;
    });
    if (rejected) return rejected;

    return NextResponse.json({ success: true });
  }, "Failed to update pot");
}

// DELETE /api/pots?id=X — delete pot, sets group_id = NULL on member transactions
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      // Budget lines first: FK cascades aren't guaranteed on hosted libsql.
      await deletePotBudgetLines(tx, userId, id);

      // Clear group_id on member transactions
      await tx
        .update(transactions)
        .set({ groupId: null })
        .where(and(eq(transactions.groupId, id), eq(transactions.userId, userId)));

      // Delete the pot
      await tx.delete(transactionGroups).where(and(eq(transactionGroups.id, id), eq(transactionGroups.userId, userId)));
    });

    return NextResponse.json({ success: true });
  }, "Failed to delete pot");
}
