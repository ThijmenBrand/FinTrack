import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tags, transactionTags } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { logDataEvent } from "@/lib/audit";
import { requireAccountAccess } from "@/lib/account-access";
import { visibleTags } from "@/lib/tags-db";
import { validateName } from "@/lib/validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/tags — the tags the caller may put on a row, with usage counts.
//
// Scoped the same way categories are, and for the same reason: a row on a
// shared account carries the OWNER's tag ids.
//   ?accountId=    — exactly that account's owner (what a row's picker offers)
//   (no params)    — the caller's own tags
//   ?scope=visible — own plus every owner sharing an account with the caller,
//                    for the filter bar, which spans accounts
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const where = accountId
      ? eq(tags.userId, (await requireAccountAccess(userId, accountId, "read")).account.userId)
      : searchParams.get("scope") === "visible"
        ? visibleTags(userId)
        : eq(tags.userId, userId);

    // The count is the caller's own business — someone else's tag comes back
    // as a name and its owner rather than a tally over accounts they cannot
    // see. The owner id is already on every account the caller can reach, and
    // the bulk bar needs it to tell two owners' vocabularies apart.
    const rows = await db
      .select({
        id: tags.id,
        name: tags.name,
        userId: tags.userId,
        // `"tags"."id"` written out rather than interpolated: in a SELECT-list
        // subquery drizzle renders a column reference unqualified (`"id"`),
        // which binds to `tt` here and silently counts nothing.
        transactionCount: sql<number>`(
          SELECT COUNT(*) FROM transaction_tags tt
          JOIN transactions t ON t.id = tt.transaction_id AND t.user_id = tt.user_id
          WHERE tt.tag_id = "tags"."id" AND tt.user_id = ${userId}
        )`,
      })
      .from(tags)
      .where(where)
      .orderBy(asc(tags.name));

    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        userId: r.userId,
        transactionCount: r.transactionCount,
      })),
    );
  }, "Failed to fetch tags");
}

// POST /api/tags — create a tag. Body: { name, accountId?, id? }
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);
    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) return apiError(nameCheck.error, 400, nameCheck.vars);

    // A tag created while working on a shared account belongs in the OWNER's
    // space, or the rows it gets put on would reference a tag their owner
    // doesn't have.
    const accountId = body?.accountId;
    if (accountId != null && typeof accountId !== "string") {
      return NextResponse.json({ error: "accountId must be a string" }, { status: 400 });
    }
    const ownerId = accountId
      ? (await requireAccountAccess(userId, accountId, "write")).account.userId
      : userId;

    // Same name, same tag: the picker creates from typed text, and the user
    // asking for "Holiday" when "Holiday" exists means the one that exists.
    // (The unique index is the real guard; this turns the race into a 409
    // rather than a 500 for the common, non-racing case.)
    const [existing] = await db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(eq(tags.userId, ownerId), eq(tags.name, nameCheck.value)))
      .limit(1);
    if (existing) return NextResponse.json(existing, { status: 200 });

    // Clients may supply the id so the picker can select the tag before this
    // request lands. Format-checked only — a stolen id collides on the primary
    // key and fails the insert, so it can never overwrite someone else's row.
    const id = UUID_RE.test(body?.id ?? "") ? (body.id as string) : crypto.randomUUID();

    await db.insert(tags).values({ id, userId: ownerId, name: nameCheck.value });

    logDataEvent({
      userId,
      action: "tag_create",
      targetId: id,
      targetType: "tag",
      details: { name: nameCheck.value },
    });

    return NextResponse.json({ id, name: nameCheck.value }, { status: 201 });
  }, "Failed to create tag");
}

// PUT /api/tags — rename a tag. Body: { id, name }
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);
    const id = body?.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });
    }
    const nameCheck = validateName(body?.name);
    if (!nameCheck.ok) return apiError(nameCheck.error, 400, nameCheck.vars);

    // Only the owner renames: a member sharing an account sees the tag but it
    // is not theirs to rewrite under everyone else.
    const updated = await db
      .update(tags)
      .set({ name: nameCheck.value })
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .returning({ id: tags.id, name: tags.name });
    if (!updated.length) return apiError("api.tagNotFound", 404);

    logDataEvent({
      userId,
      action: "tag_update",
      targetId: id,
      targetType: "tag",
      details: { name: nameCheck.value },
    });

    return NextResponse.json(updated[0]);
  }, "Failed to rename tag");
}

// DELETE /api/tags?id=x — delete a tag and take it off every row it is on.
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const ids = new URL(request.url).searchParams.getAll("id").filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });
    }

    const doomed = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, ids), eq(tags.userId, userId)));
    if (!doomed.length) return apiError("api.tagNotFound", 404);
    const doomedIds = doomed.map((t) => t.id);

    // Links first, and explicitly: `foreign_keys=ON` isn't guaranteed on
    // hosted libsql, so the cascade may simply not fire and leave rows
    // pointing at a tag that no longer exists.
    await db
      .delete(transactionTags)
      .where(and(inArray(transactionTags.tagId, doomedIds), eq(transactionTags.userId, userId)));
    await db.delete(tags).where(and(inArray(tags.id, doomedIds), eq(tags.userId, userId)));

    logDataEvent(
      doomedIds.map((id) => ({ userId, action: "tag_delete", targetId: id, targetType: "tag" })),
    );

    return NextResponse.json({ success: true, deleted: doomedIds.length });
  }, "Failed to delete tags");
}
