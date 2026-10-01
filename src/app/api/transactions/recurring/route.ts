import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactions, recurringTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { setRecurringLink } from "@/lib/recurring-link";

// PUT /api/transactions/recurring — link or unlink a transaction to a recurring plan.
// Pass `recurringTransactionId: null` to clear the link. What a link remembers
// and what it teaches the plan is setRecurringLink's (src/lib/recurring-link.ts).
// The response names the rule the plan learned and the rows it linked, so the
// client can offer to undo exactly that (POST /api/recurring/[id]/undo-learned-rule).
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

    const { learnedPattern, alsoLinkedIds } = await setRecurringLink({
      actorId: userId,
      ownerId,
      row: { id: transactionId, ...tx },
      plan: plan ?? null,
    });

    return NextResponse.json({ success: true, learnedPattern, alsoLinkedIds });
  }, "Failed to update recurring link");
}
