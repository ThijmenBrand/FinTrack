import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { potCategories, transactionGroups } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { MAX_POT_CATEGORIES, MAX_POT_CATEGORY_NAME } from "@/lib/pot-budget";
import { deletePotCategories, listPotCategories, userOwnsCategories } from "@/lib/pot-budget-db";
import type { PotCategory } from "@/types/api";

type Params = { params: Promise<{ id: string }> };
type Reader = Pick<typeof db, "select">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownsPot(reader: Reader, userId: string, potId: string): Promise<boolean> {
  const row = await reader
    .select({ id: transactionGroups.id })
    .from(transactionGroups)
    .where(and(eq(transactionGroups.id, potId), eq(transactionGroups.userId, userId)))
    .get();
  return !!row;
}

function parseName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name && name.length <= MAX_POT_CATEGORY_NAME ? name : null;
}

/** The pot's category with this name under this parent, case-insensitively. */
async function findByName(
  reader: Reader,
  userId: string,
  potId: string,
  parentCategoryId: string,
  name: string,
): Promise<PotCategory | undefined> {
  return reader
    .select({
      id: potCategories.id,
      potId: potCategories.potId,
      parentCategoryId: potCategories.parentCategoryId,
      name: potCategories.name,
    })
    .from(potCategories)
    .where(
      and(
        eq(potCategories.userId, userId),
        eq(potCategories.potId, potId),
        eq(potCategories.parentCategoryId, parentCategoryId),
        sql`lower(${potCategories.name}) = lower(${name})`,
      ),
    )
    .get();
}

// GET /api/pots/[id]/categories — the pot's own categories.
export async function GET(_request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    if (!(await ownsPot(db, userId, id))) return apiError("api.potNotFound", 404);
    return NextResponse.json(await listPotCategories(db, userId, id));
  }, "Failed to fetch pot categories");
}

// POST /api/pots/[id]/categories — { name, parentCategoryId, id? }. Creating
// one that already exists (same parent, same name) hands back the existing
// one, so a double tap or a retry never errors.
export async function POST(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id: potId } = await params;
    const body = await request.json().catch(() => null);
    const name = parseName(body?.name);
    if (!name) return apiError("pots.category.err.name", 400);
    const parentCategoryId = typeof body?.parentCategoryId === "string" ? body.parentCategoryId : "";
    const clientId = body?.id;
    if (clientId !== undefined && (typeof clientId !== "string" || !UUID_RE.test(clientId))) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const outcome = await db.transaction(async (tx) => {
      if (!(await ownsPot(tx, userId, potId))) return apiError("api.potNotFound", 404);
      if (!parentCategoryId || !(await userOwnsCategories(tx, userId, [parentCategoryId]))) {
        return apiError("api.categoryNotFound", 404);
      }
      const existing = await findByName(tx, userId, potId, parentCategoryId, name);
      if (existing) return existing;

      const [count] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(potCategories)
        .where(and(eq(potCategories.userId, userId), eq(potCategories.potId, potId)));
      if (Number(count?.n ?? 0) >= MAX_POT_CATEGORIES) {
        return apiError("pots.category.err.tooMany", 400, { max: MAX_POT_CATEGORIES });
      }

      const created: PotCategory = { id: clientId ?? crypto.randomUUID(), potId, parentCategoryId, name };
      await tx.insert(potCategories).values({ ...created, userId });
      return created;
    });
    if (outcome instanceof Response) return outcome;
    return NextResponse.json(outcome, { status: 201 });
  }, "Failed to create pot category");
}

// PATCH /api/pots/[id]/categories — { categoryId, name }: rename one.
export async function PATCH(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id: potId } = await params;
    const body = await request.json().catch(() => null);
    const name = parseName(body?.name);
    if (!name) return apiError("pots.category.err.name", 400);
    const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";

    const outcome = await db.transaction(async (tx) => {
      const current = await tx
        .select({ parentCategoryId: potCategories.parentCategoryId })
        .from(potCategories)
        .where(
          and(
            eq(potCategories.id, categoryId),
            eq(potCategories.potId, potId),
            eq(potCategories.userId, userId),
          ),
        )
        .get();
      if (!current) return apiError("api.potCategoryNotFound", 404);
      const clash = await findByName(tx, userId, potId, current.parentCategoryId, name);
      if (clash && clash.id !== categoryId) return apiError("pots.category.err.duplicate", 409);
      await tx
        .update(potCategories)
        .set({ name })
        .where(and(eq(potCategories.id, categoryId), eq(potCategories.userId, userId)));
      return null;
    });
    if (outcome) return outcome;
    return NextResponse.json({ success: true });
  }, "Failed to rename pot category");
}

// DELETE /api/pots/[id]/categories?categoryId=X — its transactions go back to
// their parent category alone; its line stops collecting it.
export async function DELETE(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id: potId } = await params;
    const categoryId = new URL(request.url).searchParams.get("categoryId");
    if (!categoryId) return apiError("api.potCategoryNotFound", 404);

    const outcome = await db.transaction(async (tx) => {
      const found = await tx
        .select({ id: potCategories.id })
        .from(potCategories)
        .where(
          and(
            eq(potCategories.id, categoryId),
            eq(potCategories.potId, potId),
            eq(potCategories.userId, userId),
          ),
        )
        .get();
      if (!found) return apiError("api.potCategoryNotFound", 404);
      await deletePotCategories(tx, userId, { ids: [categoryId] });
      return null;
    });
    if (outcome) return outcome;
    return NextResponse.json({ success: true });
  }, "Failed to delete pot category");
}
