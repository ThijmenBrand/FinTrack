import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tags, transactionTags, transactions } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { logDataEvent } from "@/lib/audit";
import { requireAccountAccess } from "@/lib/account-access";

type Params = { params: Promise<{ id: string }> };

/**
 * The row's owner, once the caller is known to be able to write to it. Row
 * lookup is unscoped by caller on purpose — write access comes from the
 * account (so a shared-account editor qualifies), not from row ownership.
 */
async function resolveOwner(userId: string, transactionId: string): Promise<string | null> {
  const [tx] = await db
    .select({ accountId: transactions.accountId, userId: transactions.userId })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  if (!tx) return null;
  const access = await requireAccountAccess(userId, tx.accountId, "write");
  return access.account.userId;
}

// POST /api/transactions/[id]/tags — put a tag on the row. Body: { tagId }
export async function POST(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const tagId = body?.tagId;
    if (typeof tagId !== "string" || !tagId) {
      return NextResponse.json({ error: "tagId is required" }, { status: 400 });
    }

    const ownerId = await resolveOwner(userId, id);
    if (!ownerId) return apiError("api.transactionNotFound", 404);

    // The tag has to live in the ROW OWNER's space — on a shared account the
    // acting member's own tag ids are not valid here, exactly as for
    // categories. 404 rather than 403: whether someone else has a tag by that
    // id is not the caller's business.
    const [tag] = await db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, ownerId)))
      .limit(1);
    if (!tag) return apiError("api.tagNotFound", 404);

    // Tagging a row that already carries the tag is a no-op, not an error —
    // two clicks in a row, or two devices, should land in the same place.
    await db
      .insert(transactionTags)
      .values({ userId: ownerId, transactionId: id, tagId })
      .onConflictDoNothing();

    logDataEvent({
      userId,
      action: "transaction_tag_add",
      targetId: id,
      targetType: "transaction",
      details: { tagId, name: tag.name },
    });

    return NextResponse.json({ success: true, tag });
  }, "Failed to tag transaction");
}

// DELETE /api/transactions/[id]/tags?tagId=x — take the tag off the row.
export async function DELETE(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const tagId = new URL(request.url).searchParams.get("tagId");
    if (!tagId) {
      return NextResponse.json({ error: "tagId is required" }, { status: 400 });
    }

    const ownerId = await resolveOwner(userId, id);
    if (!ownerId) return apiError("api.transactionNotFound", 404);

    await db
      .delete(transactionTags)
      .where(
        and(
          eq(transactionTags.transactionId, id),
          eq(transactionTags.tagId, tagId),
          eq(transactionTags.userId, ownerId),
        ),
      );

    logDataEvent({
      userId,
      action: "transaction_tag_remove",
      targetId: id,
      targetType: "transaction",
      details: { tagId },
    });

    return NextResponse.json({ success: true });
  }, "Failed to untag transaction");
}
