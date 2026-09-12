import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import {
  budgetMonthTargets,
  budgets,
  budgetSubLines,
  categories,
  categoryRules,
  recurringTransactions,
  transactionGroups,
  transactions,
} from "@/db/schema";
import { eq, sql, and, asc, count, inArray } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess, visibleCategories } from "@/lib/account-access";
import { logDataEvent } from "@/lib/audit";
import { isHexColor } from "@/lib/validation";
import type { CategoryKind } from "@/types/api";

// Allowlist for the `kind` enum — CLAUDE.md requires validating enum-like
// query/body params against an explicit list before they touch a query.
const CATEGORY_KINDS = ["income", "expense", "transfer"] as const;
function isCategoryKind(v: unknown): v is CategoryKind {
  return typeof v === "string" && (CATEGORY_KINDS as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/categories — list all categories with transaction counts.
// Rows on a shared account carry the OWNER's category ids, so a member's own
// ids are rejected by every write path (see the commit/categorize routes).
// Two scopes for pickers that must offer valid ids:
//   ?accountId=  — exactly that account's owner (single-account flows, e.g. import)
//   ?scope=visible — own + every owner sharing an account with the caller,
//                    for a mixed list where each row picks by its own owner.
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const where = accountId
      ? eq(categories.userId, (await requireAccountAccess(userId, accountId, "read")).account.userId)
      : searchParams.get("scope") === "visible"
        ? visibleCategories(userId)
        : eq(categories.userId, userId);

    const allCategories = await db
      .select()
      .from(categories)
      .where(where)
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));

    const categoriesWithCounts = await Promise.all(
      allCategories.map(async (cat) => {
        // Counts and rules stay the owner's own business — someone else's
        // category comes back as a bare label, not a tally over accounts the
        // caller can't see.
        if (cat.userId !== userId) {
          return { ...cat, transactionCount: 0, rules: [] };
        }

        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(transactions)
          .where(and(eq(transactions.categoryId, cat.id), eq(transactions.userId, userId)));

        const rulesResult = await db
          .select()
          .from(categoryRules)
          .where(and(eq(categoryRules.categoryId, cat.id), eq(categoryRules.userId, userId)));

        return {
          ...cat,
          transactionCount: countResult[0]?.count || 0,
          rules: rulesResult,
        };
      })
    );

    return NextResponse.json(categoriesWithCounts);
  }, "Failed to fetch categories");
}

// POST /api/categories — create a new category
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { name, icon, color, accountId, kind } = body;

    if (!name) {
      return apiError("api.nameRequired", 400);
    }

    // Default to "expense" so existing clients that don't send `kind` keep working.
    if (kind !== undefined && !isCategoryKind(kind)) {
      return apiError("api.invalidType", 400);
    }

    // A colour is optional here (the insert below falls back), so only one
    // that was actually supplied has to be a colour.
    if (color && !isHexColor(color)) {
      return apiError("api.invalidColor", 400);
    }
    const cleanKind: CategoryKind = isCategoryKind(kind) ? kind : "expense";

    // Same scoping as GET: a category created while working on a shared
    // account belongs in the OWNER's space, or the rows it gets attached to
    // would reference a category their owner doesn't have.
    const ownerId = accountId
      ? (await requireAccountAccess(userId, accountId, "write")).account.userId
      : userId;

    // Clients may supply the id so they can select the category before this
    // request lands. Format-checked only — a stolen id collides on the primary
    // key and fails the insert, so it can never overwrite someone else's row.
    // ponytail: no pre-flight uniqueness SELECT; the PK is the check.
    const id = UUID_RE.test(body.id ?? "") ? (body.id as string) : crypto.randomUUID();
    // New categories land at the bottom of the user's order.
    const [{ total }] = await db.select({ total: count() }).from(categories).where(eq(categories.userId, ownerId));

    await db.insert(categories).values({
      id,
      userId: ownerId,
      name,
      icon: icon || null,
      color: color || "#94a3b8",
      kind: cleanKind,
      sortOrder: total,
      createdAt: new Date().toISOString(),
    });

    const [newCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    logDataEvent({ userId, action: "category_create", targetId: id, targetType: "category", details: { name } });

    return NextResponse.json(newCategory, { status: 201 });
  }, "Failed to create category");
}

// PUT /api/categories — update a category
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, icon, color, kind } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    if (kind !== undefined && !isCategoryKind(kind)) {
      return apiError("api.invalidType", 400);
    }

    // Clearing it back to the default is allowed; setting it to something
    // that isn't a colour is not.
    if (color && !isHexColor(color)) {
      return apiError("api.invalidColor", 400);
    }

    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)));

    if (!existing) {
      return apiError("api.categoryNotFound", 404);
    }

    const updateSet: {
      name?: string;
      icon?: string | null;
      color?: string | null;
      kind?: CategoryKind;
    } = {};
    if (name !== undefined) updateSet.name = name;
    if (icon !== undefined) updateSet.icon = icon;
    if (color !== undefined) updateSet.color = color;
    if (kind !== undefined) updateSet.kind = kind;

    if (Object.keys(updateSet).length > 0) {
      await db
        .update(categories)
        .set(updateSet)
        .where(and(eq(categories.id, id), eq(categories.userId, userId)));
    }

    const [updated] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, userId)));

    logDataEvent({
      userId,
      action: "category_update",
      targetId: id,
      targetType: "category",
      details: { name },
    });

    return NextResponse.json(updated);
  }, "Failed to update category");
}

// PATCH /api/categories — reorder categories
export async function PATCH(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { orderedIds } = body as { orderedIds: string[] };

    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { error: "orderedIds array is required" },
        { status: 400 }
      );
    }

    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(categories)
        .set({ sortOrder: i })
        .where(and(eq(categories.id, orderedIds[i]), eq(categories.userId, userId)));
    }

    return NextResponse.json({ success: true });
  }, "Failed to reorder categories");
}

// DELETE /api/categories — delete one category (?id=x) or several (?id=x&id=y)
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const ids = searchParams.getAll("id");

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Category ID is required" },
        { status: 400 }
      );
    }

    const doomed = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(inArray(categories.id, ids), eq(categories.userId, userId)));

    const doomedIds = doomed.map((cat) => cat.id);

    if (doomedIds.length > 0) {
      // Drop the FK but keep the name as plain text, so history stays readable.
      for (const cat of doomed) {
        await db
          .update(transactions)
          .set({ categoryId: null, categoryLabel: cat.name, categorySource: null })
          .where(and(eq(transactions.categoryId, cat.id), eq(transactions.userId, userId)));
      }

      await db
        .update(recurringTransactions)
        .set({ categoryId: null })
        .where(
          and(
            inArray(recurringTransactions.categoryId, doomedIds),
            eq(recurringTransactions.userId, userId)
          )
        );

      await db
        .update(transactionGroups)
        .set({ categoryId: null })
        .where(
          and(
            inArray(transactionGroups.categoryId, doomedIds),
            eq(transactionGroups.userId, userId)
          )
        );

      await db.delete(budgetSubLines).where(
        and(
          eq(budgetSubLines.userId, userId),
          inArray(
            budgetSubLines.allocationId,
            db
              .select({ id: budgets.id })
              .from(budgets)
              .where(
                and(
                  inArray(budgets.categoryId, doomedIds),
                  eq(budgets.userId, userId)
                )
              )
          )
        )
      );

      await db
        .delete(budgets)
        .where(
          and(
            inArray(budgets.categoryId, doomedIds),
            eq(budgets.userId, userId)
          )
        );

      await db
        .delete(budgetMonthTargets)
        .where(
          and(
            inArray(budgetMonthTargets.categoryId, doomedIds),
            eq(budgetMonthTargets.userId, userId)
          )
        );

      await db
        .delete(categoryRules)
        .where(
          and(
            inArray(categoryRules.categoryId, doomedIds),
            eq(categoryRules.userId, userId)
          )
        );
    }

    const deleted = await db
      .delete(categories)
      .where(and(inArray(categories.id, ids), eq(categories.userId, userId)))
      .returning({ id: categories.id });

    for (const { id } of deleted) {
      logDataEvent({ userId, action: "category_delete", targetId: id, targetType: "category" });
    }

    return NextResponse.json({ success: true, deleted: deleted.length });
  }, "Failed to delete categories");
}
