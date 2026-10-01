import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { recurringTransactions, transactions } from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { requireAccountAccess } from "@/lib/account-access";

// Kept well under SQLite's bound-parameter limit.
const CHUNK = 500;

// POST /api/recurring/[id]/undo-learned-rule — take back what a first link
// taught the plan. body: { pattern: string, transactionIds: string[] }
//
// Clears the rule, but only while it is still the learned `pattern` — a rule
// the user has edited since is theirs now. Unlinks exactly the rows the
// backfill linked (and their split slices) that are still on this plan. The
// row the user linked by hand stays linked; the unlinked rows are not marked
// as excluded, since the user never rejected any of them individually.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const pattern = typeof body?.pattern === "string" ? body.pattern : null;
    const ids: string[] = Array.isArray(body?.transactionIds)
      ? body.transactionIds.filter((v: unknown): v is string => typeof v === "string")
      : [];
    if (!pattern) {
      return NextResponse.json({ error: "pattern is required" }, { status: 400 });
    }

    // Unscoped by caller — the write-access check on the plan's account
    // decides who may change it, as in PUT /api/recurring.
    const [plan] = await db
      .select({
        accountId: recurringTransactions.accountId,
        userId: recurringTransactions.userId,
        matchPattern: recurringTransactions.matchPattern,
      })
      .from(recurringTransactions)
      .where(eq(recurringTransactions.id, id))
      .limit(1);
    if (!plan) return apiError("api.recurringNotFound", 404);
    const access = await requireAccountAccess(userId, plan.accountId, "write");
    const ownerId = access.account.userId;

    await db.transaction(async (tx) => {
      if (plan.matchPattern === pattern) {
        await tx
          .update(recurringTransactions)
          .set({ matchPattern: null })
          .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, ownerId)));
      }
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        await tx
          .update(transactions)
          .set({ recurringTransactionId: null, modifiedBy: userId })
          .where(
            and(
              eq(transactions.userId, ownerId),
              eq(transactions.recurringTransactionId, id),
              or(inArray(transactions.id, chunk), inArray(transactions.parentTransactionId, chunk)),
            ),
          );
      }
    });

    logDataEvent({
      userId,
      action: "recurring_undo_learned_rule",
      targetId: id,
      targetType: "recurring",
      details: {
        count: ids.length,
        ...(ownerId !== userId ? { accountOwnerId: ownerId } : {}),
      },
    });

    return NextResponse.json({ success: true });
  }, "Failed to undo learned rule");
}
