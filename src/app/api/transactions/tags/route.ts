import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tags, transactions } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { logDataEvent } from "@/lib/audit";
import { writableTransactions } from "@/lib/account-access";
import { addTagToTransactions, removeTagFromTransactions, visibleTags } from "@/lib/tags-db";

/**
 * Capped like the bulk delete's MAX_DELETE_IDS, for the same reason: one
 * statement per batch, and a cap so a stray client can't ask for an unbounded
 * IN-list. The ids travel in the BODY here, so the delete route's 200 — a
 * query-string ceiling — doesn't apply, and this matches bulk categorize
 * instead, down to the 1..500 message.
 */
const MAX_TAG_IDS = 500;

// POST /api/transactions/tags — put one tag on, or take it off, a whole
// selection. Body: { transactionIds, tagId, action: "add" | "remove" }
//
// The per-row endpoint is /api/transactions/[id]/tags; this is the same two
// writes done set-based, with the same owner rule (see below).
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json().catch(() => null);

    const action: unknown = body?.action;
    if (action !== "add" && action !== "remove") {
      return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
    }
    const tagId: unknown = body?.tagId;
    if (typeof tagId !== "string" || !tagId) {
      return NextResponse.json({ error: "tagId is required" }, { status: 400 });
    }

    const ids = [
      ...new Set(
        (Array.isArray(body?.transactionIds) ? (body.transactionIds as unknown[]) : []).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ];
    if (!ids.length || ids.length > MAX_TAG_IDS) {
      return apiError("api.transactionIdRange", 400);
    }

    // The tag has to exist somewhere the caller can see at all — narrowed the
    // way the categorize route narrows its category lookup, so a hit and a
    // miss can't be used to probe whether a stranger holds that id.
    const [tag] = await db
      .select({ id: tags.id, name: tags.name, userId: tags.userId })
      .from(tags)
      .where(and(eq(tags.id, tagId), visibleTags(userId)))
      .limit(1);
    if (!tag) return apiError("api.tagNotFound", 404);

    // Rows the caller may WRITE, and of those only the ones the TAG's owner
    // owns. A tag lives in the account owner's space, so a selection spanning
    // two owners can only take this tag on the half that owner owns; the rest
    // is silently skipped, the same convention bulk categorize follows for
    // ids outside the category owner's space. `writableTransactions` also
    // drops viewer-shared rows and names user_id for the tenant guard.
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          inArray(transactions.id, ids),
          eq(transactions.userId, tag.userId),
          writableTransactions(userId),
        ),
      );
    const targetIds = rows.map((r) => r.id);

    if (targetIds.length) {
      if (action === "add") await addTagToTransactions(tag.userId, tag.id, targetIds);
      else await removeTagFromTransactions(tag.userId, tag.id, targetIds);

      // One event per row, as the bulk delete logs: the audit trail reads the
      // same whether a tag was put on from the row or from the bulk bar.
      logDataEvent(
        targetIds.map((id) => ({
          userId,
          action: action === "add" ? "transaction_tag_add" : "transaction_tag_remove",
          targetId: id,
          targetType: "transaction",
          details: { tagId: tag.id, name: tag.name, bulk: true },
        })),
      );
    }

    // `skipped` is how many of the asked-for ids this tag could not reach —
    // someone else's half of a mixed selection, or a row gone since the page
    // loaded. Not an error: the rest of the batch still landed.
    return NextResponse.json({
      success: true,
      action,
      tagId: tag.id,
      count: targetIds.length,
      skipped: ids.length - targetIds.length,
    });
  }, "Failed to tag transactions");
}
