import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { budgets, budgetSubLines, recurringTransactions } from "@/db/schema";
import { eq, and, asc, inArray, ne, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { logDataEvent } from "@/lib/audit";
import { resolveBudgetPlan, resolveBudgetRowAccess } from "@/lib/budget-plan";
import { isFiniteNumber, validateName } from "@/lib/validation";
import { fromMonthly, toMonthly } from "@/lib/recurring";
import {
  MAX_SUB_LINE_DEPTH,
  MAX_SUB_LINES_PER_ALLOCATION,
  SUB_LINE_ERROR,
  SUB_LINE_ERROR_MESSAGE,
  countSubLines,
  flattenSubLines,
  resyncUpwards,
  subLineDepth,
} from "@/lib/budget-sub-lines";
import type { SubCategoryOption } from "@/types/api";

/** A rule violation, as both a translatable code and an English fallback. */
function ruleError(code: string) {
  return NextResponse.json(
    { error: SUB_LINE_ERROR_MESSAGE[code], code },
    { status: 400 },
  );
}

// GET /api/budgets/sub-lines?accountId= — the sub-categories a transaction on
// that account can be filed under: every sub-line of the account's budget plan,
// flat and pre-ordered, tagged with the category it refines.
//
// The budgets page reads the same lines as a tree inside the plan payload; a
// picker wants neither the tree nor the plan's spend math, so it asks here.
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    const { account } = await requireAccountAccess(userId, accountId, "read");
    // Null budgetId falls back to the caller's own main plan — the same plan
    // the dashboard budgets against.
    const plan = await resolveBudgetPlan(userId, account.budgetId);
    // Rows on this account belong to its OWNER, and only that owner's sub-line
    // ids survive the write path's check (see subLineCategories), so a plan
    // belonging to anyone else has nothing to offer here.
    if (!plan || plan.ownerId !== account.userId) {
      return NextResponse.json([]);
    }

    const rows = await db
      .select({
        id: budgetSubLines.id,
        parentId: budgetSubLines.parentId,
        name: budgetSubLines.name,
        categoryId: budgets.categoryId,
      })
      .from(budgetSubLines)
      .innerJoin(budgets, eq(budgets.id, budgetSubLines.allocationId))
      .where(and(eq(budgetSubLines.userId, plan.ownerId), eq(budgets.budgetId, plan.id)))
      // Creation order, the order the budget editor shows them in.
      .orderBy(asc(budgetSubLines.createdAt), asc(budgetSubLines.id));

    const options: SubCategoryOption[] = flattenSubLines(rows);
    return NextResponse.json(options);
  }, "Failed to fetch sub-categories");
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
      return apiError(validatedName.error, 400, validatedName.vars);
    }
    // A zero-amount sub-line is a label with no plan behind it; the client
    // refuses to submit one, so the endpoint agrees rather than diverging.
    if (!isFiniteNumber(amount) || amount <= 0) {
      return apiError("api.invalidAmount", 400);
    }
    if (parentId !== undefined && parentId !== null && typeof parentId !== "string") {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }

    const [allocation] = await db
      .select({ id: budgets.id, userId: budgets.userId, budgetId: budgets.budgetId })
      .from(budgets)
      .where(eq(budgets.id, allocationId))
      .limit(1);
    if (!allocation) {
      return apiError("api.budgetNotFound", 404);
    }
    const access = await resolveBudgetRowAccess(userId, allocation);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 403 ? "Read-only access" : "Budget not found" },
        { status: access.status },
      );
    }
    const dataUserId = access.dataUserId;

    // Cap check, insert and roll-up share one transaction: read-then-write
    // across two connections lets two concurrent creates both see room that
    // only one of them can actually have, and lets one overwrite the other's
    // re-summed parent.
    const id = crypto.randomUUID();
    const outcome = await db.transaction(async (tx) => {
      if ((await countSubLines(tx, allocationId, dataUserId)) >= MAX_SUB_LINES_PER_ALLOCATION) {
        return SUB_LINE_ERROR.tooMany;
      }

      let resolvedParentId: string | null = null;

      if (parentId) {
        const [parent] = await tx
          .select({
            id: budgetSubLines.id,
            allocationId: budgetSubLines.allocationId,
            recurringTransactionId: budgetSubLines.recurringTransactionId,
          })
          .from(budgetSubLines)
          .where(and(eq(budgetSubLines.id, parentId), eq(budgetSubLines.userId, dataUserId)))
          .limit(1);
        if (!parent || parent.allocationId !== allocationId) return "parent_not_found";
        // Same rule POST /api/budgets applies to a submitted tree: a line's
        // money comes from its plan or from its children, never both.
        if (parent.recurringTransactionId) return "parent_recurring";

        if ((await subLineDepth(tx, parent.id, dataUserId)) + 1 > MAX_SUB_LINE_DEPTH) {
          return SUB_LINE_ERROR.tooDeep;
        }

        resolvedParentId = parent.id;
      }

      await tx.insert(budgetSubLines).values({
        id,
        userId: dataUserId,
        allocationId,
        parentId: resolvedParentId,
        name: validatedName.value,
        amount,
        createdAt: new Date().toISOString(),
      });
      await resyncUpwards(tx, allocationId, dataUserId, resolvedParentId);
      return { parentId: resolvedParentId };
    });

    if (outcome === "parent_not_found") {
      return apiError("api.parentSubLineNotFound", 404);
    }
    if (outcome === "parent_recurring") {
      return NextResponse.json(
        {
          error: "A recurring sub-line's amount comes from its plan; it can't be broken down",
          code: "sub_line_parent_recurring",
        },
        { status: 400 },
      );
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
        ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}),
      },
    });

    const [created] = await db
      .select()
      .from(budgetSubLines)
      .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, dataUserId)))
      .limit(1);

    return NextResponse.json(created, { status: 201 });
  }, "Failed to create sub-line");
}

// PUT /api/budgets/sub-lines — update a sub-line's name, amount, and/or its
// link to a recurring plan
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, amount, recurringId } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Sub-line ID is required" }, { status: 400 });
    }
    // `null` unlinks; a string links; absent leaves the link untouched.
    if (recurringId !== undefined && recurringId !== null && typeof recurringId !== "string") {
      return NextResponse.json({ error: "Invalid recurringId" }, { status: 400 });
    }

    const updates: { name?: string; amount?: number; recurringTransactionId?: string | null } = {};

    if (name !== undefined) {
      const validatedName = validateName(name);
      if (!validatedName.ok) {
        return apiError(validatedName.error, 400, validatedName.vars);
      }
      updates.name = validatedName.value;
    }
    if (amount !== undefined) {
      if (!isFiniteNumber(amount) || amount <= 0) {
        return apiError("api.invalidAmount", 400);
      }
      updates.amount = amount;
    }

    const [subLine] = await db
      .select({ allocationId: budgetSubLines.allocationId, userId: budgetSubLines.userId })
      .from(budgetSubLines)
      .where(eq(budgetSubLines.id, id))
      .limit(1);
    if (!subLine) {
      return apiError("api.subLineNotFound", 404);
    }
    const [allocation] = await db
      .select({ userId: budgets.userId, budgetId: budgets.budgetId })
      .from(budgets)
      .where(eq(budgets.id, subLine.allocationId))
      .limit(1);
    if (!allocation) {
      return apiError("api.subLineNotFound", 404);
    }
    const access = await resolveBudgetRowAccess(userId, allocation);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 403 ? "Read-only access" : "Sub-line not found" },
        { status: access.status },
      );
    }
    const dataUserId = access.dataUserId;

    // Same rules as `adoptRecurringId` in POST /api/budgets: the owner's own
    // plan, an expense, on an account this allocation's plan scopes. Resolved
    // before the transaction, same as the plan lookup there.
    if (typeof recurringId === "string") {
      const plan = await resolveBudgetPlan(userId, allocation.budgetId);
      const [linkTarget] = await db
        .select({
          amount: recurringTransactions.amount,
          frequency: recurringTransactions.frequency,
        })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.id, recurringId),
            eq(recurringTransactions.userId, dataUserId),
            eq(recurringTransactions.type, "expense"),
            ...(plan
              ? [
                  plan.accountIds.length > 0
                    ? inArray(recurringTransactions.accountId, plan.accountIds)
                    : sql`1=0`,
                ]
              : []),
          ),
        )
        .limit(1);
      if (!linkTarget) {
        return apiError("api.recurringNotFound", 404);
      }
      // Linking takes the line's amount, same as an adopted line in POST.
      updates.recurringTransactionId = recurringId;
      updates.amount = toMonthly(linkTarget.amount, linkTarget.frequency);
    } else if (recurringId === null) {
      // Unlinking leaves the amount exactly where it is — the line just goes
      // back to being an ordinary planning line.
      updates.recurringTransactionId = null;
    }

    // Same reasoning as POST: the row, the write and the roll-up it triggers
    // have to see one snapshot. `updates` only carries what the caller
    // actually sent, so an edit that doesn't mention `recurringId` leaves an
    // existing link alone.
    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(budgetSubLines)
        .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, dataUserId)))
        .limit(1);
      if (!existing) return "not_found";

      if (typeof recurringId === "string") {
        // A plan can back at most one sub-line — enforced here rather than a
        // partial unique index (see the sub-lines migration notes).
        const [linked] = await tx
          .select({ id: budgetSubLines.id })
          .from(budgetSubLines)
          .where(
            and(
              eq(budgetSubLines.recurringTransactionId, recurringId),
              eq(budgetSubLines.userId, dataUserId),
              ne(budgetSubLines.id, id),
            ),
          )
          .limit(1);
        if (linked) return "already_linked";

        // The other half of the same rule: a container already gets its amount
        // from its children, so it can't take a plan's on top.
        const [child] = await tx
          .select({ id: budgetSubLines.id })
          .from(budgetSubLines)
          .where(
            and(
              eq(budgetSubLines.parentId, id),
              eq(budgetSubLines.userId, dataUserId),
            ),
          )
          .limit(1);
        if (child) return "has_children";
      }

      // A linked line's money IS the plan's money, so a new amount here is a
      // new amount there — the other direction of the mirror PUT /api/recurring
      // already keeps. Only while the link stays put: linking takes its amount
      // from the plan, and unlinking hands the line back to itself.
      if (
        updates.amount !== undefined &&
        recurringId === undefined &&
        existing.recurringTransactionId
      ) {
        const [plan] = await tx
          .select({
            type: recurringTransactions.type,
            frequency: recurringTransactions.frequency,
          })
          .from(recurringTransactions)
          .where(
            and(
              eq(recurringTransactions.id, existing.recurringTransactionId),
              eq(recurringTransactions.userId, dataUserId),
            ),
          )
          .limit(1);
        if (plan) {
          // Sub-line amounts are always positive and monthly; a recurring row
          // is per occurrence and signed by its type, same as PUT /api/recurring.
          const perOccurrence = fromMonthly(updates.amount, plan.frequency);
          await tx
            .update(recurringTransactions)
            .set({ amount: plan.type === "income" ? perOccurrence : -perOccurrence })
            .where(
              and(
                eq(recurringTransactions.id, existing.recurringTransactionId),
                eq(recurringTransactions.userId, dataUserId),
              ),
            );
        }
      }

      if (Object.keys(updates).length > 0) {
        await tx
          .update(budgetSubLines)
          .set(updates)
          .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, dataUserId)));
      }
      if (updates.amount !== undefined) {
        // From the row itself, not its container: a leaf has no children so it
        // resolves to the same walk, but a row that DOES have children snaps
        // straight back onto their sum. The client makes such a field
        // read-only; this is what keeps a direct API call honest too.
        await resyncUpwards(tx, existing.allocationId, dataUserId, existing.id);
      }
      return "ok";
    });

    if (outcome === "not_found") {
      return apiError("api.subLineNotFound", 404);
    }
    if (outcome === "has_children") {
      return NextResponse.json(
        {
          error: "A sub-line that adds up from its children can't also stand for a recurring plan",
          code: "sub_line_has_children",
        },
        { status: 400 },
      );
    }
    if (outcome === "already_linked") {
      // No translatable key for this yet — same machine code POST /api/budgets
      // uses for the equivalent conflict, so the client maps it once.
      return NextResponse.json(
        { error: "That recurring plan is already linked to a sub-line", code: "recurring_already_linked" },
        { status: 409 },
      );
    }

    if (Object.keys(updates).length > 0) {
      logDataEvent({
        userId,
        action: "budget_subline_update",
        targetId: id,
        targetType: "budget_sub_line",
        details: { ...updates, ...(dataUserId !== userId ? { accountOwnerId: dataUserId } : {}) },
      });
    }

    const [updated] = await db
      .select()
      .from(budgetSubLines)
      .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, dataUserId)))
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

    const [subLine] = await db
      .select({ allocationId: budgetSubLines.allocationId, userId: budgetSubLines.userId })
      .from(budgetSubLines)
      .where(eq(budgetSubLines.id, id))
      .limit(1);
    if (!subLine) {
      return apiError("api.subLineNotFound", 404);
    }
    const [allocation] = await db
      .select({ userId: budgets.userId, budgetId: budgets.budgetId })
      .from(budgets)
      .where(eq(budgets.id, subLine.allocationId))
      .limit(1);
    if (!allocation) {
      return apiError("api.subLineNotFound", 404);
    }
    const access = await resolveBudgetRowAccess(userId, allocation);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.status === 403 ? "Read-only access" : "Sub-line not found" },
        { status: access.status },
      );
    }
    const dataUserId = access.dataUserId;

    const found = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: budgetSubLines.id,
          allocationId: budgetSubLines.allocationId,
          parentId: budgetSubLines.parentId,
        })
        .from(budgetSubLines)
        .where(and(eq(budgetSubLines.id, id), eq(budgetSubLines.userId, dataUserId)))
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
              eq(budgetSubLines.userId, dataUserId),
            ),
          );
        frontier = children.map((c) => c.id);
        doomed.push(...frontier);
      }

      // One statement for the whole subtree — nothing can observe a state
      // where a child outlived its parent. The linked recurring plans, if any,
      // survive: only the breakdown lines go.
      await tx
        .delete(budgetSubLines)
        .where(
          and(inArray(budgetSubLines.id, doomed), eq(budgetSubLines.userId, dataUserId)),
        );
      // The row's own subtree left with it, so the change is in its container.
      await resyncUpwards(tx, existing.allocationId, dataUserId, existing.parentId);
      return true;
    });

    if (!found) {
      return apiError("api.subLineNotFound", 404);
    }

    logDataEvent({
      userId,
      action: "budget_subline_delete",
      targetId: id,
      targetType: "budget_sub_line",
      details: dataUserId !== userId ? { accountOwnerId: dataUserId } : undefined,
    });

    return NextResponse.json({ success: true });
  }, "Failed to delete sub-line");
}
