import { NextResponse } from "next/server";
import { readFile } from "@/lib/file-store";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionAttachments, transactions } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { contentDisposition, isAttachmentPathname } from "@/lib/attachments";

/**
 * GET /api/attachments/<id> — read-through for the private file store.
 *
 * The store serves nothing publicly, so every receipt is fetched here with the
 * caller's session cookie attached and re-checked against the transaction's
 * account: on a shared account a member reads the owner's files, and a
 * transaction the caller can't see has no readable attachments.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withUser(async (userId) => {
    const [row] = await db
      .select({
        userId: transactionAttachments.userId,
        transactionId: transactionAttachments.transactionId,
        pathname: transactionAttachments.pathname,
        fileName: transactionAttachments.fileName,
        contentType: transactionAttachments.contentType,
        uploadedBy: transactionAttachments.uploadedBy,
      })
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, id));
    // One 404 for "no such file" and for "not yours" alike — the id space
    // shouldn't be probeable.
    if (!row) {
      return apiError("api.notFound", 404);
    }

    if (row.transactionId) {
      const [tx] = await db
        .select({ accountId: transactions.accountId, userId: transactions.userId })
        .from(transactions)
        .where(eq(transactions.id, row.transactionId));
      if (!tx) {
        return apiError("api.notFound", 404);
      }
      await requireAccountAccess(userId, tx.accountId, "read");
    } else if (row.uploadedBy !== userId) {
      // Not claimed by a transaction yet: it exists only inside the import
      // review of whoever uploaded it.
      return apiError("api.notFound", 404);
    }

    // Never trust a stored string blindly: the key must look like one we wrote.
    if (!isAttachmentPathname(row.pathname)) {
      return apiError("api.notFound", 404);
    }

    const file = await readFile(row.pathname);
    if (!file) {
      return apiError("api.notFound", 404);
    }

    return new NextResponse(file.stream, {
      headers: {
        // Set at upload time from the sniffed bytes, never from the request, so
        // a stored object can't talk the browser into treating it as anything
        // but the image or PDF it is.
        "Content-Type": row.contentType,
        "Content-Length": String(file.size),
        // `inline` so a click opens a preview rather than a download; the
        // filename is percent-encoded, since it came off the user's disk and
        // could otherwise carry a CRLF into the header.
        "Content-Disposition": contentDisposition(row.fileName),
        "X-Content-Type-Options": "nosniff",
        // The pathname's random suffix means a given URL's bytes never change,
        // so this can be cached hard. `private` keeps it out of shared caches,
        // where the next visitor through the same hop could otherwise be handed
        // someone else's receipt.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }, "Failed to load attachment");
}
