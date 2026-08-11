import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { budgets } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { touchAllLedgers } from "@/lib/budget-jobs";
import { logDataEvent } from "@/lib/audit";

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
 */
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
      await db
        .delete(budgets)
        .where(
          and(
            eq(budgets.userId, userId),
            eq(budgets.status, "suggested"),
            inArray(budgets.id, ids),
          ),
        );
      logDataEvent({ userId, action: "budget_suggestion_reject", targetType: "budget", details: { count: ids.length } });
      return NextResponse.json({ success: true, count: ids.length });
    }

    const items = Array.isArray(body?.items) ? (body.items as AcceptItem[]) : [];
    if (items.length === 0) return NextResponse.json({ error: "items[] is required" }, { status: 400 });

    const ids = items.map((i) => i.id).filter((v): v is string => typeof v === "string");
    if (ids.length === 0) return NextResponse.json({ error: "items[].id is required" }, { status: 400 });

    const overrideById = new Map<string, number | undefined>();
    for (const item of items) {
      if (typeof item.id === "string") overrideById.set(item.id, typeof item.amount === "number" ? item.amount : undefined);
    }

    const accepted = await db.transaction(async (tx) => {
      const suggestions = await tx
        .select()
        .from(budgets)
        .where(and(eq(budgets.userId, userId), eq(budgets.status, "suggested"), inArray(budgets.id, ids)));

      if (suggestions.length === 0) return 0;

      const now = new Date().toISOString();
      let count = 0;

      for (const suggestion of suggestions) {
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
              eq(budgets.userId, userId),
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
            .where(and(eq(budgets.id, existingActive[0].id), eq(budgets.userId, userId)));
          await tx.delete(budgets).where(and(eq(budgets.id, suggestion.id), eq(budgets.userId, userId)));
        } else {
          await tx
            .update(budgets)
            .set({ amount: finalAmount, status: "active", isActive: true, source: "auto", generatedAt: now })
            .where(and(eq(budgets.id, suggestion.id), eq(budgets.userId, userId)));
        }
        count += 1;
      }

      return count;
    });

    logDataEvent({ userId, action: "budget_suggestion_accept", targetType: "budget", details: { count: accepted } });

    // Accepted suggestions are allocations, so the envelopes change with them.
    await touchAllLedgers(userId);

    return NextResponse.json({ success: true, count: accepted });
  }, "Failed to process budget suggestion");
}
