import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { accounts, categories, recurringTransactions, transactions } from "@/db/schema";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { getAccountAccess, memberAccountIds, visibleTransactions } from "@/lib/account-access";
import { nextUnpaidOccurrence } from "@/lib/recurring";
import { learnMatchRule, looksLikePlan, matchesPlanRule } from "@/lib/recurring-match";
import { isLogoPending, logoUrl, scheduleLogoLookups } from "@/lib/recurring-logo";

/** Unlinked look-alikes offered for linking — enough to act on, not a search. */
const MAX_SUGGESTIONS = 10;

const txColumns = {
  id: transactions.id,
  date: transactions.date,
  name: transactions.name,
  description: transactions.description,
  amount: transactions.amount,
  accountName: accounts.name,
  categoryName: categories.name,
  categoryColor: categories.color,
};

// GET /api/recurring/[id] — one plan, every payment linked to it (newest
// first) and the unlinked rows that look like it.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withUser(async (userId) => {
    const { id } = await params;

    const [row] = await db
      .select({
        id: recurringTransactions.id,
        userId: recurringTransactions.userId,
        accountId: recurringTransactions.accountId,
        accountName: accounts.name,
        description: recurringTransactions.description,
        amount: recurringTransactions.amount,
        type: recurringTransactions.type,
        categoryId: recurringTransactions.categoryId,
        categoryKind: categories.kind,
        categoryName: categories.name,
        categoryColor: categories.color,
        frequency: recurringTransactions.frequency,
        dayOfWeek: recurringTransactions.dayOfWeek,
        dayOfMonth: recurringTransactions.dayOfMonth,
        monthOfYear: recurringTransactions.monthOfYear,
        startDate: recurringTransactions.startDate,
        endDate: recurringTransactions.endDate,
        isActive: recurringTransactions.isActive,
        matchPattern: recurringTransactions.matchPattern,
        matchField: recurringTransactions.matchField,
        matchDescriptionPattern: recurringTransactions.matchDescriptionPattern,
        logoKey: recurringTransactions.logoKey,
        logoSource: recurringTransactions.logoSource,
        logoCheckedAt: recurringTransactions.logoCheckedAt,
      })
      .from(recurringTransactions)
      .leftJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
      .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
      .where(
        and(
          eq(recurringTransactions.id, id),
          or(
            eq(recurringTransactions.userId, userId),
            inArray(recurringTransactions.accountId, memberAccountIds(userId)),
          ),
        ),
      )
      .limit(1);
    if (!row) return apiError("api.recurringNotFound", 404);

    const access = await getAccountAccess(userId, row.accountId);
    const canEdit = !!access && access.role !== "viewer";
    const { userId: ownerId, logoKey, logoCheckedAt, ...plan } = row;
    scheduleLogoLookups([row]);

    const [linked, unlinked] = await Promise.all([
      // Bank rows only: a split bill's slices inherit the link, and listing
      // them too would count the same payment twice.
      db
        .select(txColumns)
        .from(transactions)
        .leftJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            eq(transactions.recurringTransactionId, id),
            visibleTransactions(userId),
            isNull(transactions.parentTransactionId),
          ),
        )
        .orderBy(desc(transactions.date), desc(transactions.createdAt)),
      // Look-alikes: the plan's account and direction, not linked to anything,
      // and not a row the user already unlinked from this plan by hand.
      // Text is matched in JS (looksLikePlan) — the same tokenising the rule
      // side uses can't be expressed as one LIKE. Only offered to someone who
      // can link them, so a viewer skips the scan.
      canEdit
        ? db
            .select(txColumns)
            .from(transactions)
            .leftJoin(accounts, eq(transactions.accountId, accounts.id))
            .leftJoin(categories, eq(transactions.categoryId, categories.id))
            .where(
              and(
                eq(transactions.userId, ownerId),
                eq(transactions.accountId, plan.accountId),
                eq(transactions.type, plan.type),
                isNull(transactions.recurringTransactionId),
                isNull(transactions.parentTransactionId),
                or(
                  isNull(transactions.recurringExcludedPlanId),
                  ne(transactions.recurringExcludedPlanId, id),
                ),
              ),
            )
            .orderBy(desc(transactions.date))
        : Promise.resolve([]),
    ]);
    // A plan without a rule — linked before plans learned, or from a row it
    // couldn't learn from — has never looked for the rest of its payments.
    // The rules its linked rows would teach find them: "one is linked, so
    // are these?". Linking one of them teaches the plan for real.
    const linkedRules = plan.matchPattern
      ? []
      : linked.flatMap((t) => learnMatchRule(t) ?? []);
    const suggestions = unlinked
      .filter(
        (t) =>
          looksLikePlan(plan.description, t.name, t.description) ||
          linkedRules.some((rule) => matchesPlanRule(rule, t.name, t.description)),
      )
      .slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({
      plan: {
        ...plan,
        logoUrl: logoUrl(plan.id, logoKey),
        logoPending: isLogoPending({ logoKey, logoCheckedAt }),
        nextOccurrence: plan.isActive ? nextUnpaidOccurrence(plan, linked[0]?.date) : null,
      },
      canEdit,
      transactions: linked,
      suggestions,
    });
  }, "Failed to fetch recurring plan");
}
