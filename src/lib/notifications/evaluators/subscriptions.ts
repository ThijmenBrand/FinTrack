import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions, transactions } from "@/db/schema";
import { excludeSplitChildren } from "@/lib/split-sql";
import { detectSubscriptions } from "@/lib/subscription-detect";
import { toIsoDate } from "@/lib/utils";
import { draft } from "../dispatch";
import type { Evaluator } from "./types";

/** Long enough for three monthly charges with a late one in between. */
const LOOKBACK_DAYS = 200;

export const subscriptionEvaluator: Evaluator = {
  types: ["subscription.detected"],
  async run(ctx) {
    const today = toIsoDate(ctx.now);
    const from = toIsoDate(new Date(ctx.now.getTime() - LOOKBACK_DAYS * 86_400_000));
    const [rows, plans] = await Promise.all([
      db
        .select({
          accountId: transactions.accountId,
          date: transactions.date,
          name: transactions.name,
          description: transactions.description,
          amount: transactions.amount,
          categoryId: transactions.categoryId,
          recurringExcludedPlanId: transactions.recurringExcludedPlanId,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, ctx.userId),
            eq(transactions.type, "expense"),
            lt(transactions.amount, 0),
            gte(transactions.date, from),
            // Rows already linked to a plan are, by definition, not news.
            isNull(transactions.recurringTransactionId),
            excludeSplitChildren(),
          ),
        ),
      db
        .select({
          id: recurringTransactions.id,
          accountId: recurringTransactions.accountId,
          description: recurringTransactions.description,
          amount: recurringTransactions.amount,
          type: recurringTransactions.type,
          isActive: recurringTransactions.isActive,
          matchPattern: recurringTransactions.matchPattern,
          matchField: recurringTransactions.matchField,
          matchDescriptionPattern: recurringTransactions.matchDescriptionPattern,
        })
        .from(recurringTransactions)
        .where(eq(recurringTransactions.userId, ctx.userId)),
    ]);

    return detectSubscriptions(rows, plans, today).map((s) =>
      draft(
        "subscription.detected",
        {
          merchant: s.merchant,
          amount: s.amount,
          frequency: s.frequency,
          accountId: s.accountId,
          categoryId: s.categoryId,
          count: s.count,
          firstDate: s.firstDate,
          lastDate: s.lastDate,
        },
        `subscription.detected:${s.key}`,
      ),
    );
  },
};
