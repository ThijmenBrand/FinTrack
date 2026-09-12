import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
// ponytail: sharp is pinned to ^0.34.5 for the same reason the avatar route
// documents — Turbopack builds on Vercel don't ship 0.35.x's libvips .so.
import sharp from "sharp";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionAttachments, transactions } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { requireAccountAccess } from "@/lib/account-access";
import { getRequestMeta, logDataEvent } from "@/lib/audit";
import { createRateLimiter } from "@/lib/rate-limit";
import { collectOrphanAttachments, discardBlob } from "@/lib/attachment-store";
import {
  ATTACHMENT_IMAGE_MAX_EDGE,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
  MAX_FILE_NAME_LENGTH,
  detectAttachmentType,
} from "@/lib/attachments";
import type { TransactionAttachment } from "@/types/api";

// Re-encoding is the expensive part, so uploads get their own limit rather
// than riding the global 100/min. It is also the cap on how much a single
// session can push into the store, since a row parked by an in-progress import
// has no per-transaction count to check against yet. A month of receipts is a
// dozen files; 30 per 15 minutes leaves room without letting one session loop
// sharp or fill the bucket.
const allowUpload = createRateLimiter(15 * 60 * 1000, 30);

/**
 * The account owner whose space an attachment belongs in, plus a permission
 * check on the transaction it hangs off.
 *
 * Returns null when the transaction doesn't exist; throws the 404/403 Response
 * `requireAccountAccess` raises when the caller may not touch its account.
 */
async function transactionOwner(
  userId: string,
  transactionId: string,
  level: "read" | "write",
): Promise<string | null> {
  const [tx] = await db
    .select({ accountId: transactions.accountId, userId: transactions.userId })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  if (!tx) return null;
  const access = await requireAccountAccess(userId, tx.accountId, level);
  return access.account.userId;
}

/** What the client needs to render a tile — never the pathname. */
const publicColumns = {
  id: transactionAttachments.id,
  fileName: transactionAttachments.fileName,
  contentType: transactionAttachments.contentType,
  size: transactionAttachments.size,
  createdAt: transactionAttachments.createdAt,
  // Named so the tenant guard (src/db/index.ts) sees user_id in every
  // statement built from this projection.
  userId: transactionAttachments.userId,
};

function toPublic(row: TransactionAttachment & { userId?: string }): TransactionAttachment {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    createdAt: row.createdAt,
  };
}

// GET /api/attachments?transactionId=… — the files on one transaction
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const transactionId = new URL(request.url).searchParams.get("transactionId");
    if (!transactionId) {
      return apiError("api.transactionIdRequired", 400);
    }

    const ownerId = await transactionOwner(userId, transactionId, "read");
    if (!ownerId) {
      return apiError("api.transactionNotFound", 404);
    }

    const rows = await db
      .select(publicColumns)
      .from(transactionAttachments)
      .where(
        and(
          eq(transactionAttachments.transactionId, transactionId),
          eq(transactionAttachments.userId, ownerId),
        ),
      )
      .orderBy(asc(transactionAttachments.createdAt));

    return NextResponse.json({ attachments: rows.map(toPublic) });
  }, "Failed to load attachments");
}

/**
 * POST /api/attachments — attach a file to a transaction, or park one for an
 * import that hasn't been committed yet.
 *
 * Body is multipart: `file`, plus either `transactionId` (an existing row) or
 * `accountId` (a CSV row still in review — the transaction does not exist, so
 * the row is stored unclaimed and the import commit claims it by id).
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return apiError("api.attachmentsNotConfigured", 503);
    }
    if (!allowUpload(userId)) {
      return apiError("api.rateLimitedUploads", 429);
    }

    // Reject on the declared length before formData() buffers the whole body
    // into memory. The 1.1 leaves room for multipart framing; file.size below
    // is the real check.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES * 1.1) {
      return apiError("api.attachmentTooLarge", 400);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const transactionId = (formData.get("transactionId") as string | null) || null;
    const accountId = (formData.get("accountId") as string | null) || null;

    // `instanceof File`, not a cast: a part sent as a plain text field would
    // otherwise reach `file.arrayBuffer()` and surface as a 500.
    if (!(file instanceof File)) {
      return apiError("api.fileRequired", 400);
    }
    if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
      return apiError("api.attachmentTooLarge", 400);
    }
    if (!transactionId && !accountId) {
      return apiError("api.transactionIdRequired", 400);
    }

    // Write access decides who may attach, resolved through the transaction
    // when there is one and through the target account during an import.
    let ownerId: string | null;
    if (transactionId) {
      ownerId = await transactionOwner(userId, transactionId, "write");
      if (!ownerId) {
        return apiError("api.transactionNotFound", 404);
      }
      const [{ existing }] = await db
        .select({ existing: count() })
        .from(transactionAttachments)
        .where(
          and(
            eq(transactionAttachments.transactionId, transactionId),
            eq(transactionAttachments.userId, ownerId),
          ),
        );
      if (existing >= MAX_ATTACHMENTS_PER_TRANSACTION) {
        return apiError("api.tooManyAttachments", 400, {
          max: MAX_ATTACHMENTS_PER_TRANSACTION,
        });
      }
    } else {
      const access = await requireAccountAccess(userId, accountId!, "write");
      ownerId = access.account.userId;
    }

    const raw = new Uint8Array(await file.arrayBuffer());
    // file.type is whatever the client claimed. Trust the bytes instead.
    const kind = detectAttachmentType(raw);
    if (!kind) {
      return apiError("api.attachmentTypeUnsupported", 400);
    }

    // A PDF is stored byte-for-byte; only images go through sharp.
    let bytes: Buffer = Buffer.from(raw);
    let contentType = "application/pdf";
    let extension = "pdf";
    if (kind !== "pdf") {
      try {
        bytes = await sharp(raw, { limitInputPixels: 268402689 })
          // .rotate() bakes in the EXIF orientation; sharp drops all other
          // metadata by default, so the GPS tag a phone writes into a photo of
          // a receipt never reaches the store.
          .rotate()
          .resize(ATTACHMENT_IMAGE_MAX_EDGE, ATTACHMENT_IMAGE_MAX_EDGE, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        return apiError("api.attachmentUnreadable", 400);
      }
      contentType = "image/webp";
      extension = "webp";
    }

    // Uploading is one of the two moments garbage appears, so sweep here.
    // Keyed by the OWNER, since that is whose space the rows live in — on a
    // shared account the caller has no garbage of their own to find.
    await collectOrphanAttachments(ownerId);

    const id = crypto.randomUUID();
    // Random suffix, not a stable path: reusing a pathname leaves the CDN
    // serving the previous file for up to a month.
    const blob = await put(`attachments/${id}.${extension}`, bytes, {
      access: "private",
      contentType,
      addRandomSuffix: true,
    });

    const fileName = (file.name || `receipt.${extension}`).slice(0, MAX_FILE_NAME_LENGTH);
    const row = {
      id,
      userId: ownerId,
      transactionId,
      // The pathname, not `blob.url` — a private store's URL needs credentials
      // to fetch, so what we persist is the key /api/attachments/<id> reads back.
      pathname: blob.pathname,
      fileName,
      contentType,
      size: bytes.byteLength,
      uploadedBy: userId,
      createdAt: new Date().toISOString(),
    };
    await db.insert(transactionAttachments).values(row);

    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    logDataEvent({
      userId,
      action: "attachment_add",
      targetId: transactionId ?? id,
      targetType: "transaction",
      details: { fileName, size: row.size, ...(transactionId ? {} : { pending: true }) },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ attachment: toPublic(row) });
  }, "Failed to upload attachment");
}

// DELETE /api/attachments?id=… — remove one file, bytes and all
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return apiError("api.attachmentNotFound", 404);
    }

    const [row] = await db
      .select({
        id: transactionAttachments.id,
        userId: transactionAttachments.userId,
        transactionId: transactionAttachments.transactionId,
        pathname: transactionAttachments.pathname,
        uploadedBy: transactionAttachments.uploadedBy,
        fileName: transactionAttachments.fileName,
      })
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, id));
    if (!row) {
      return apiError("api.attachmentNotFound", 404);
    }

    if (row.transactionId) {
      // Write access to the row's account, same gate as attaching.
      if (!(await transactionOwner(userId, row.transactionId, "write"))) {
        return apiError("api.attachmentNotFound", 404);
      }
    } else if (row.uploadedBy !== userId) {
      // Still unclaimed: it belongs to whoever's import review is holding it,
      // and nobody else can even see it.
      return apiError("api.attachmentNotFound", 404);
    }

    await discardBlob(row.pathname);
    await db
      .delete(transactionAttachments)
      .where(
        and(
          eq(transactionAttachments.id, row.id),
          eq(transactionAttachments.userId, row.userId),
        ),
      );

    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    logDataEvent({
      userId,
      action: "attachment_remove",
      targetId: row.transactionId ?? row.id,
      targetType: "transaction",
      details: { fileName: row.fileName },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  }, "Failed to remove attachment");
}
