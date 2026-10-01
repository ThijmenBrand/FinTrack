import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactions, recurringTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { requireAccountAccess } from "@/lib/account-access";
import { learnMatchRule } from "@/lib/recurring-match";
import { linkMatchingTransactions } from "@/lib/recurring-backfill";

// PUT /api/transactions/recurring — link or unlink a transaction to a recurring plan.
// Pass `recurringTransactionId: null` to clear the link. An unlink by hand is
// remembered (`recurringExcludedPlanId`), so automatic matching never hands the
// row back to that plan; linking by hand forgets it again.
//
// The first row linked to a plan by hand teaches it: the plan learns a match
// rule from that row (see learnMatchRule) and every matching row in its
// history is linked right away, so "link once" means every month after too.
// The response names the rule and the rows it linked, so the client can offer
// to undo exactly that (POST /api/recurring/[id]/undo-learned-rule).
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { transactionId, recurringTransactionId } = body as {
      transactionId?: string;
      recurringTransactionId?: string | null;
    };

    if (!transactionId) {
      return NextResponse.json(
        { error: "transactionId is required" },
        { status: 400 }
      );
    }

    const [tx] = await db
      .select({
        accountId: transactions.accountId,
        userId: transactions.userId,
        name: transactions.name,
        description: transactions.description,
        recurringTransactionId: transactions.recurringTransactionId,
        recurringExcludedPlanId: transactions.recurringExcludedPlanId,
      })
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    if (!tx) {
      return apiError("api.transactionNotFound", 404);
    }
    const access = await requireAccountAccess(userId, tx.accountId, "write");
    const ownerId = access.account.userId;

    let plan: { id: string; accountId: string; matchPattern: string | null } | undefined;
    if (recurringTransactionId) {
      [plan] = await db
        .select({
          id: recurringTransactions.id,
          accountId: recurringTransactions.accountId,
          matchPattern: recurringTransactions.matchPattern,
        })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.id, recurringTransactionId),
            eq(recurringTransactions.userId, ownerId)
          )
        );
      if (!plan) {
        return apiError("api.recurringNotFound", 404);
      }
    }

    await db
      .update(transactions)
      .set({
        recurringTransactionId: recurringTransactionId ?? null,
        recurringExcludedPlanId: recurringTransactionId
          ? null
          : (tx.recurringTransactionId ?? tx.recurringExcludedPlanId),
        modifiedBy: userId,
      })
      .where(
        and(eq(transactions.id, transactionId), eq(transactions.userId, ownerId))
      );

    logDataEvent({
      userId,
      action: recurringTransactionId
        ? "transaction_link_recurring"
        : "transaction_unlink_recurring",
      targetId: transactionId,
      targetType: "transaction",
      details: {
        recurringTransactionId: recurringTransactionId ?? null,
        ...(ownerId !== userId ? { accountOwnerId: ownerId } : {}),
      },
    });

    // Only a row on the plan's own account can teach it — the rule only ever
    // matches there (see recurring-match.ts).
    let learnedPattern: string | null = null;
    let alsoLinkedIds: string[] = [];
    if (plan && !plan.matchPattern && plan.accountId === tx.accountId) {
      const rule = learnMatchRule(tx);
      if (rule) {
        await db
          .update(recurringTransactions)
          .set(rule)
          .where(
            and(eq(recurringTransactions.id, plan.id), eq(recurringTransactions.userId, ownerId))
          );
        learnedPattern = rule.matchPattern;
        alsoLinkedIds = await linkMatchingTransactions(plan.id, ownerId);
      }
    }

    return NextResponse.json({ success: true, learnedPattern, alsoLinkedIds });
  }, "Failed to update recurring link");
}
