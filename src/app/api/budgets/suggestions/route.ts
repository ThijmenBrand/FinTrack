import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { budgets } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { resolveBudgetRowAccess } from "@/lib/budget-plan";

interface AcceptItem {
  id: string;
  amount?: number;
}

/**
 * POST /api/budgets/suggestions — accept or reject pending suggestions.
 * body: { action: "accept" | "reject", items?: AcceptItem[], ids?: string[] }
 *
 * Accept: each item is converted into the active budget for its category.
 *   - If the user already has an active manual budget for that category, its
 *     amount is updated to the suggested (or overridden) amount and the
 *     suggestion row is deleted.
 *   - Otherwise the suggestion row is promoted to status='active' (and isActive).
 *
 * Reject: the suggestion rows are deleted.
 *
 * Suggestions are generated in the plan OWNER's space, so an editor of a
 * shared plan acts on rows whose userId isn't theirs: each row is checked with
 * resolveBudgetRowAccess, and rows the caller can't write are skipped.
 */
async function writableSuggestions(userId: string, ids: string[]) {
  const rows = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.status, "suggested"), inArray(budgets.id, ids)));
  // Rows of one plan share an answer — resolve each (owner, plan) pair once.
  const access = new Map<string, boolean>();
  const writable: typeof rows = [];
  for (const row of rows) {
    const key = `${row.userId}:${row.budgetId ?? ""}`;
    let ok = access.get(key);
    if (ok === undefined) {
      ok = (await resolveBudgetRowAccess(userId, row)).ok;
      access.set(key, ok);
    }
    if (ok) writable.push(row);
  }
  return writable;
}

export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const action = body?.action as "accept" | "reject" | undefined;

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
    }

    if (action === "reject") {
      const ids = Array.isArray(body?.ids) ? (body.ids as string[]).filter((v) => typeof v === "string") : [];
      if (ids.length === 0) return NextResponse.json({ error: "ids[] is required" }, { status: 400 });
      const rows = await writableSuggestions(userId, ids);
      // Each delete stays scoped to the owner whose space the rows live in.
      const idsByOwner = new Map<string, string[]>();
      for (const row of rows) idsByOwner.set(row.userId, [...(idsByOwner.get(row.userId) ?? []), row.id]);
      for (const [ownerId, ownerIds] of idsByOwner) {
        await db
          .delete(budgets)
          .where(and(eq(budgets.userId, ownerId), eq(budgets.status, "suggested"), inArray(budgets.id, ownerIds)));
      }
      logDataEvent({ userId, action: "budget_suggestion_reject", targetType: "budget", details: { count: rows.length } });
      return NextResponse.json({ success: true, count: rows.length });
    }

    const items = Array.isArray(body?.items) ? (body.items as AcceptItem[]) : [];
    if (items.length === 0) return NextResponse.json({ error: "items[] is required" }, { status: 400 });

    const ids = items.map((i) => i.id).filter((v): v is string => typeof v === "string");
    if (ids.length === 0) return NextResponse.json({ error: "items[].id is required" }, { status: 400 });

    const overrideById = new Map<string, number | undefined>();
    for (const item of items) {
      if (typeof item.id === "string") overrideById.set(item.id, typeof item.amount === "number" ? item.amount : undefined);
    }

    const suggestions = await writableSuggestions(userId, ids);
    if (suggestions.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const accepted = await db.transaction(async (tx) => {
      const now = new Date().toISOString();
      let count = 0;

      for (const suggestion of suggestions) {
        // The plan owner's space — the caller's own for their own plans.
        const dataUserId = suggestion.userId;
        const override = overrideById.get(suggestion.id);
        const finalAmount =
          typeof override === "number" && Number.isFinite(override) && override > 0
            ? override
            : suggestion.amount;

        // The replaced allocation must live in the same plan as the
        // suggestion — the same category can be budgeted in several plans.
        const existingActive = await tx
          .select({ id: budgets.id })
          .from(budgets)
          .where(
            and(
              eq(budgets.userId, dataUserId),
              eq(budgets.categoryId, suggestion.categoryId),
              eq(budgets.status, "active"),
              eq(budgets.isActive, true),
              suggestion.budgetId
                ? eq(budgets.budgetId, suggestion.budgetId)
                : isNull(budgets.budgetId),
            ),
          )
          .limit(1);

        if (existingActive.length > 0) {
          await tx
            .update(budgets)
            .set({ amount: finalAmount, source: "auto", generatedAt: now })
            .where(and(eq(budgets.id, existingActive[0].id), eq(budgets.userId, dataUserId)));
          await tx.delete(budgets).where(and(eq(budgets.id, suggestion.id), eq(budgets.userId, dataUserId)));
        } else {
          await tx
            .update(budgets)
            .set({ amount: finalAmount, status: "active", isActive: true, source: "auto", generatedAt: now })
            .where(and(eq(budgets.id, suggestion.id), eq(budgets.userId, dataUserId)));
        }
        count += 1;
      }

      return count;
    });

    logDataEvent({ userId, action: "budget_suggestion_accept", targetType: "budget", details: { count: accepted } });
    return NextResponse.json({ success: true, count: accepted });
  }, "Failed to process budget suggestion");
}
