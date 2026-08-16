import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { budgets, budgetSubLines } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { isFiniteNumber, validateName, MONEY_EPSILON } from "@/lib/validation";
import {
  MAX_SUB_LINE_DEPTH,
  MAX_SUB_LINES_PER_ALLOCATION,
  SUB_LINE_ERROR,
  SUB_LINE_ERROR_MESSAGE,
  countSubLines,
  subLineDepth,
  sumChildren,
  sumSiblings,
} from "@/lib/budget-sub-lines";

/** A rule violation, as both a translatable code and an English fallback. */
function ruleError(code: string) {
  return NextResponse.json(
    { error: SUB_LINE_ERROR_MESSAGE[code], code },
    { status: 400 },
  );
}

// POST /api/budgets/sub-lines — create a sub-line under an allocation or another sub-line
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { allocationId, parentId, name, amount } = body;

    if (!allocationId || typeof allocationId !== "string") {
      return NextResponse.json({ error: "allocationId is required" }, { status: 400 });
    }

    const validatedName = validateName(name);
    if (!validatedName.ok) {
      return NextResponse.json({ error: validatedName.error }, { status: 400 });
    }
    // A zero-amount sub-line is a label with no plan behind it; the client
    // refuses to submit one, so the endpoint agrees rather than diverging.
    if (!isFiniteNumber(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (parentId !== undefined && parentId !== null && typeof parentId !== "string") {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }

    const [allocation] = await db
      .select({ id: budgets.id, amount: budgets.amount })
      .from(budgets)
      .where(and(eq(budgets.id, allocationId), eq(budgets.userId, userId)))
      .limit(1);
    if (!allocation) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    // Cap check and insert share one transaction: read-then-write across two
    // connections lets two concurrent creates both see room that only one of
    // them can actually have.
    const id = crypto.randomUUID();
    const outcome = await db.transaction(async (tx) => {
      if ((await countSubLines(tx, allocationId, userId)) >= MAX_SUB_LINES_PER_ALLOCATION) {
        return SUB_LINE_ERROR.tooMany;
      }

      let cap = allocation.amount;
      let resolvedParentId: string | null = null;

      if (parentId) {
        const [parent] = await tx
          .select({
            id: budgetSubLines.id,
            amount: budgetSubLines.amount,
            allocationId: budgetSubLines.allocationId,
          })
          .from(budgetSubLines)
          .where(and(eq(budgetSubLines.id, parentId), eq(budgetSubLines.userId, userId)))
          .limit(1);
        if (!parent || parent.allocationId !== allocationId) return "parent_not_found";

        if ((await subLineDepth(tx, parent.id, userId)) + 1 > MAX_SUB_LINE_DEPTH) {
          return SUB_LINE_ERROR.tooDeep;
        }

        cap = parent.amount;
        resolvedParentId = parent.id;
      }

      const siblingSum = await sumSiblings(tx, allocationId, userId, resolvedParentId);
      if (siblingSum + amount > cap + MONEY_EPSILON) return SUB_LINE_ERROR.exceedsParent;

      await tx.insert(budgetSubLines).values({
        id,
        userId,
        allocationId,
        parentId: resolvedParentId,
        name: validatedName.value,
        amount,
        createdAt: new Date().toISOString(),
      });
      return { parentId: resolvedParentId };
    });

    if (outcome === "parent_not_found") {
      return NextResponse.json({ error: "Parent sub-line not found" }, { status: 404 });
    }
    if (typeof outcome === "string") return ruleError(outcome);

    logDataEvent({
      userId,
      action: "budget_subline_create",
      targetId: id,
      targetType: "budget_sub_line",
      details: {
        allocationId,
        parentId: outcome.parentId,
        name: validatedName.value,
        amount,
      },
    });

    const [created] = await db
      .select()
      .from(budgetSubLines)
      .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, userId)))
      .limit(1);

    return NextResponse.json(created, { status: 201 });
  }, "Failed to create sub-line");
}

// PUT /api/budgets/sub-lines — update a sub-line's name and/or amount
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, amount } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Sub-line ID is required" }, { status: 400 });
    }

    const updates: { name?: string; amount?: number } = {};

    if (name !== undefined) {
      const validatedName = validateName(name);
      if (!validatedName.ok) {
        return NextResponse.json({ error: validatedName.error }, { status: 400 });
      }
      updates.name = validatedName.value;
    }
    if (amount !== undefined) {
      if (!isFiniteNumber(amount) || amount <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }
      updates.amount = amount;
    }

    // Same reasoning as POST: the caps are only meaningful if the row they
    // describe can't move between the check and the write.
    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(budgetSubLines)
        .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, userId)))
        .limit(1);
      if (!existing) return "not_found";

      if (updates.amount !== undefined) {
        let cap: number;
        if (existing.parentId) {
          const [parent] = await tx
            .select({ amount: budgetSubLines.amount })
            .from(budgetSubLines)
            .where(
              and(
                eq(budgetSubLines.id, existing.parentId),
                eq(budgetSubLines.userId, userId),
              ),
            )
            .limit(1);
          cap = parent?.amount ?? 0;
        } else {
          const [allocation] = await tx
            .select({ amount: budgets.amount })
            .from(budgets)
            .where(
              and(
                eq(budgets.id, existing.allocationId),
                eq(budgets.userId, userId),
              ),
            )
            .limit(1);
          cap = allocation?.amount ?? 0;
        }

        const siblingSum = await sumSiblings(
          tx,
          existing.allocationId,
          userId,
          existing.parentId,
          existing.id,
        );
        if (siblingSum + updates.amount > cap + MONEY_EPSILON) {
          return SUB_LINE_ERROR.exceedsParent;
        }

        const childrenSum = await sumChildren(tx, existing.id, userId);
        if (updates.amount < childrenSum - MONEY_EPSILON) {
          return SUB_LINE_ERROR.belowChildren;
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx
          .update(budgetSubLines)
          .set(updates)
          .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, userId)));
      }
      return "ok";
    });

    if (outcome === "not_found") {
      return NextResponse.json({ error: "Sub-line not found" }, { status: 404 });
    }
    if (outcome !== "ok") return ruleError(outcome);

    if (Object.keys(updates).length > 0) {
      logDataEvent({
        userId,
        action: "budget_subline_update",
        targetId: id,
        targetType: "budget_sub_line",
        details: updates,
      });
    }

    const [updated] = await db
      .select()
      .from(budgetSubLines)
      .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, userId)))
      .limit(1);

    return NextResponse.json(updated);
  }, "Failed to update sub-line");
}

// DELETE /api/budgets/sub-lines?id= — delete a sub-line and its descendants.
// Explicit cleanup instead of relying on FK cascades — libsql connections
// don't guarantee foreign_keys=ON (see budget-plans DELETE for precedent).
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Sub-line ID is required" }, { status: 400 });
    }

    const found = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: budgetSubLines.id })
        .from(budgetSubLines)
        .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, userId)))
        .limit(1);
      if (!existing) return false;

      // Collect the subtree a level at a time. Depth is capped on create, so
      // this terminates after at most MAX_SUB_LINE_DEPTH rounds even if a row
      // somehow points at a parent it shouldn't.
      const doomed = [id];
      let frontier = [id];
      for (let level = 1; level < MAX_SUB_LINE_DEPTH && frontier.length > 0; level++) {
        const children = await tx
          .select({ id: budgetSubLines.id })
          .from(budgetSubLines)
          .where(
            and(
              inArray(budgetSubLines.parentId, frontier),
              eq(budgetSubLines.userId, userId),
            ),
          );
        frontier = children.map((c) => c.id);
        doomed.push(...frontier);
      }

      // One statement for the whole subtree — nothing can observe a state
      // where a child outlived its parent.
      await tx
        .delete(budgetSubLines)
        .where(
          and(inArray(budgetSubLines.id, doomed), eq(budgetSubLines.userId, userId)),
        );
      return true;
    });

    if (!found) {
      return NextResponse.json({ error: "Sub-line not found" }, { status: 404 });
    }

    logDataEvent({
      userId,
      action: "budget_subline_delete",
      targetId: id,
      targetType: "budget_sub_line",
    });

    return NextResponse.json({ success: true });
  }, "Failed to delete sub-line");
}
