import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import {
  recurringTransactions,
  accounts,
  categories,
  budgetSubLines,
} from "@/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { memberAccountIds, requireAccountAccess } from "@/lib/account-access";
import { getNextOccurrence, isOccurrencePaid, toMonthly } from "@/lib/recurring";
import { lastPaidByPlan } from "@/lib/recurring-paid";
import { resyncUpwards } from "@/lib/budget-sub-lines";
import { isFiniteNumber, isIsoDate } from "@/lib/validation";

const RECURRING_TYPES = ["income", "expense"] as const;
const FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const;
type RecurringType = (typeof RECURRING_TYPES)[number];
type Frequency = (typeof FREQUENCIES)[number];

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Validate the client-supplied recurring-transaction fields that are present
 * in `body`. Returns an error message, or null if everything present is valid.
 */
function validateRecurringFields(body: Record<string, unknown>): string | null {
  if ("amount" in body && !isFiniteNumber(body.amount)) return "amount must be a finite number";
  if ("type" in body && !RECURRING_TYPES.includes(body.type as RecurringType))
    return `type must be one of: ${RECURRING_TYPES.join(", ")}`;
  if ("frequency" in body && !FREQUENCIES.includes(body.frequency as Frequency))
    return `frequency must be one of: ${FREQUENCIES.join(", ")}`;
  if ("description" in body && (typeof body.description !== "string" || !body.description.trim()))
    return "description must be a non-empty string";
  if ("startDate" in body && !isIsoDate(body.startDate)) return "startDate must be YYYY-MM-DD";
  if ("endDate" in body && body.endDate != null && body.endDate !== "" && !isIsoDate(body.endDate))
    return "endDate must be YYYY-MM-DD";
  if ("dayOfWeek" in body && body.dayOfWeek != null && !isIntInRange(body.dayOfWeek, 0, 6))
    return "dayOfWeek must be 0-6";
  if ("dayOfMonth" in body && body.dayOfMonth != null && !isIntInRange(body.dayOfMonth, 1, 31))
    return "dayOfMonth must be 1-31";
  if ("monthOfYear" in body && body.monthOfYear != null && !isIntInRange(body.monthOfYear, 1, 12))
    return "monthOfYear must be 1-12";
  return null;
}

/** True when `categoryOwnerId` (the recurring plan's data-owner space) owns `categoryId`. */
async function userOwnsCategory(userId: string, categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return !!row;
}

// GET /api/recurring — list all recurring transactions with next occurrence
export async function GET() {
  return withUser(async (userId) => {
    const rows = await db
      .select({
        id: recurringTransactions.id,
        accountId: recurringTransactions.accountId,
        accountName: accounts.name,
        description: recurringTransactions.description,
        amount: recurringTransactions.amount,
        type: recurringTransactions.type,
        categoryId: recurringTransactions.categoryId,
        // Transfer-category plans move money between the user's own accounts,
        // so the list keeps them out of its income/expense totals.
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
        createdAt: recurringTransactions.createdAt,
      })
      .from(recurringTransactions)
      .leftJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
      .leftJoin(
        categories,
        eq(recurringTransactions.categoryId, categories.id)
      )
      // Own recurring plans plus those on accounts shared with the caller
      // (those rows keep the owner's user_id).
      .where(
        or(
          eq(recurringTransactions.userId, userId),
          inArray(recurringTransactions.accountId, memberAccountIds(userId)),
        ),
      );

    const lastPaid = await lastPaidByPlan(rows.map((r) => r.id), userId);

    const withNextOccurrence = rows.map((r) => {
      if (!r.isActive) return { ...r, nextOccurrence: null };
      const next = getNextOccurrence(
        r.frequency,
        r.startDate,
        r.dayOfWeek,
        r.dayOfMonth,
        r.monthOfYear
      );
      // Payment already in for that date? Skip ahead to the one after it.
      return {
        ...r,
        nextOccurrence: isOccurrencePaid(r.frequency, next, lastPaid.get(r.id))
          ? getNextOccurrence(
              r.frequency,
              r.startDate,
              r.dayOfWeek,
              r.dayOfMonth,
              r.monthOfYear,
              new Date(next)
            )
          : next,
      };
    });

    return NextResponse.json(withNextOccurrence);
  }, "Failed to fetch recurring transactions");
}

// POST /api/recurring — create a recurring transaction
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const {
      accountId,
      description,
      amount,
      type,
      categoryId,
      frequency,
      dayOfWeek,
      dayOfMonth,
      monthOfYear,
      startDate,
      endDate,
    } = body;

    if (!accountId || !description || amount === undefined || !type || !frequency || !startDate) {
      return NextResponse.json(
        { error: "accountId, description, amount, type, frequency, and startDate are required" },
        { status: 400 }
      );
    }

    const invalid = validateRecurringFields(body);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    // Write access to the account — 404 if the caller can't see it, 403 if
    // they're a viewer. Data-owner space (row userId, category lookup) is the
    // ACCOUNT OWNER, same as any other row on a shared account.
    const access = await requireAccountAccess(userId, accountId, "write");
    const ownerId = access.account.userId;
    if (categoryId && !(await userOwnsCategory(ownerId, categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    const id = crypto.randomUUID();
    await db.insert(recurringTransactions).values({
      id,
      accountId,
      description,
      amount: type === "income" ? Math.abs(amount) : -Math.abs(amount),
      type,
      categoryId: categoryId || null,
      frequency,
      dayOfWeek: dayOfWeek ?? null,
      dayOfMonth: dayOfMonth ?? null,
      monthOfYear: monthOfYear ?? null,
      startDate,
      endDate: endDate || null,
      isActive: true,
      userId: ownerId,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  }, "Failed to create recurring transaction");
}

// PUT /api/recurring — update a recurring transaction
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    const invalid = validateRecurringFields(body);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    // Unscoped by caller — the write-access check below (via the row's
    // account) decides who may edit it, not row ownership.
    const [existing] = await db
      .select()
      .from(recurringTransactions)
      .where(eq(recurringTransactions.id, id))
      .limit(1);
    if (!existing) {
      return apiError("api.notFound", 404);
    }
    const access = await requireAccountAccess(userId, existing.accountId, "write");
    const ownerId = access.account.userId;

    if (body.accountId) {
      // Reassigning to another account: must be writable too, and owned by
      // the SAME owner — a recurring plan can't cross owner spaces.
      const newAccess = await requireAccountAccess(userId, body.accountId, "write");
      if (newAccess.account.userId !== ownerId) {
        return apiError("api.accountNotFound", 404);
      }
    }
    if (body.categoryId && !(await userOwnsCategory(ownerId, body.categoryId))) {
      return apiError("api.categoryNotFound", 404);
    }

    // Explicit field allowlist — never spread the client body into `set`
    // (userId/createdAt/id must not be client-settable).
    const updates: Partial<typeof recurringTransactions.$inferInsert> = {};
    if ("description" in body) updates.description = (body.description as string).trim();
    if ("type" in body) updates.type = body.type;
    if ("categoryId" in body) updates.categoryId = body.categoryId || null;
    if ("accountId" in body) updates.accountId = body.accountId;
    if ("frequency" in body) updates.frequency = body.frequency;
    if ("dayOfWeek" in body) updates.dayOfWeek = body.dayOfWeek ?? null;
    if ("dayOfMonth" in body) updates.dayOfMonth = body.dayOfMonth ?? null;
    if ("monthOfYear" in body) updates.monthOfYear = body.monthOfYear ?? null;
    if ("startDate" in body) updates.startDate = body.startDate;
    if ("endDate" in body) updates.endDate = body.endDate || null;
    if ("isActive" in body) updates.isActive = Boolean(body.isActive);
    if ("amount" in body) {
      // Ensure amount sign matches the (possibly updated) type.
      const effectiveType = (updates.type ?? existing.type) as string;
      updates.amount =
        effectiveType === "income" ? Math.abs(body.amount) : -Math.abs(body.amount);
    }

    // The update and the linked sub-line's re-normalisation must land
    // together: a reader can't be allowed to see the recurring row's new
    // amount before the budget tree that mirrors it has caught up.
    await db.transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx
          .update(recurringTransactions)
          .set(updates)
          .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, ownerId)));
      }

      // A sub-line linked to this plan carries the same money, expressed
      // monthly — only amount/frequency changes affect what that monthly
      // figure is. A type or category change is left alone here: re-parenting
      // the sub-line into a different allocation is a separate decision, not
      // something this endpoint should guess at.
      if ("amount" in updates || "frequency" in updates) {
        const effectiveAmount = updates.amount ?? existing.amount;
        const effectiveFrequency = updates.frequency ?? existing.frequency;
        const [linked] = await tx
          .select({ id: budgetSubLines.id, allocationId: budgetSubLines.allocationId })
          .from(budgetSubLines)
          .where(
            and(
              eq(budgetSubLines.recurringTransactionId, id),
              eq(budgetSubLines.userId, ownerId),
            ),
          )
          .limit(1);
        if (linked) {
          // toMonthly takes the absolute value; the recurring row's amount is
          // signed (expenses negative) but a sub-line amount is always positive.
          await tx
            .update(budgetSubLines)
            .set({ amount: toMonthly(effectiveAmount, effectiveFrequency) })
            .where(and(eq(budgetSubLines.id, linked.id), eq(budgetSubLines.userId, ownerId)));
          await resyncUpwards(tx, linked.allocationId, ownerId, linked.id);
        }
      }
    });

    return NextResponse.json({ success: true });
  }, "Failed to update recurring transaction");
}

// DELETE /api/recurring — delete a recurring transaction
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select({ accountId: recurringTransactions.accountId, userId: recurringTransactions.userId })
      .from(recurringTransactions)
      .where(eq(recurringTransactions.id, id))
      .limit(1);
    if (!existing) {
      // Matches the prior idempotent-delete behavior: nothing to authorize
      // against, nothing to delete.
      return NextResponse.json({ success: true });
    }
    const access = await requireAccountAccess(userId, existing.accountId, "write");
    const ownerId = access.account.userId;

    // Explicit cleanup instead of relying on the FK's `on delete set null` —
    // libsql connections don't guarantee foreign_keys=ON (see the DELETE in
    // /api/budgets/sub-lines/route.ts for the same precedent). The sub-line
    // keeps its amount and becomes an ordinary planning line, so no re-sum:
    // its contribution to every ancestor's sum hasn't changed, only the link
    // that used to explain where the number came from.
    await db.transaction(async (tx) => {
      await tx
        .update(budgetSubLines)
        .set({ recurringTransactionId: null })
        .where(
          and(
            eq(budgetSubLines.recurringTransactionId, id),
            eq(budgetSubLines.userId, ownerId),
          ),
        );
      await tx
        .delete(recurringTransactions)
        .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, ownerId)));
    });

    return NextResponse.json({ success: true });
  }, "Failed to delete recurring transaction");
}
