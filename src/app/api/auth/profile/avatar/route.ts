import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { put, del } from "@vercel/blob";
// ponytail: sharp is pinned to ^0.34.5 — the version Next itself depends on.
// Turbopack builds on Vercel don't ship 0.35.x's libvips .so, so the route
// 500s with ERR_DLOPEN_FAILED. Unpin once lovell/sharp#4567 is fixed.
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { withUser } from "@/lib/auth";
import { logDataEvent, getRequestMeta } from "@/lib/audit";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  AVATAR_SIZE,
  MAX_AVATAR_BYTES,
  avatarSrc,
  detectImageType,
  isAvatarPathname,
} from "@/lib/avatar";

// Re-encoding is the expensive part of this route, so it gets its own limit
// rather than riding the global 100/min: 10 uploads per 15 minutes, enough to
// stop a single session from looping sharp.
const allowUpload = createRateLimiter(15 * 60 * 1000, 10);

async function currentImage(userId: string): Promise<string | null> {
  const result = await db.run(sql`SELECT image FROM "user" WHERE id = ${userId}`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return (row?.image as string | null) ?? null;
}

async function setImage(userId: string, url: string | null): Promise<void> {
  await db.run(
    sql`UPDATE "user" SET image = ${url}, updated_at = ${new Date().toISOString()} WHERE id = ${userId}`,
  );
}

/** Drop a superseded avatar. Never fatal — a leaked blob beats a failed save. */
async function discard(pathname: string | null): Promise<void> {
  if (!isAvatarPathname(pathname)) return;
  try {
    await del(pathname);
  } catch {
    // The new image is already live; an orphan in the store is cosmetic.
  }
}

// POST /api/auth/profile/avatar — replace the current user's profile picture
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return apiError("api.avatarNotConfigured", 503);
    }
    if (!allowUpload(userId)) {
      return apiError("api.rateLimitedUploads", 429);
    }

    // Reject on the declared length before formData() buffers the whole body
    // into memory. The 1.1 leaves room for multipart framing overhead; file.size
    // below is the real check.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_AVATAR_BYTES * 1.1) {
      return apiError("api.imageTooLarge", 400);
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return apiError("api.fileRequired", 400);
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return apiError("api.imageTooLarge", 400);
    }

    const raw = new Uint8Array(await file.arrayBuffer());
    // file.type is whatever the client claimed. Trust the bytes instead.
    if (!detectImageType(raw)) {
      return apiError("api.imageTypeUnsupported", 400);
    }

    let out: Buffer;
    try {
      out = await sharp(raw, { limitInputPixels: 268402689 })
        // .rotate() bakes in the EXIF orientation; sharp drops all other
        // metadata by default, so camera GPS never reaches a public URL.
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      return apiError("api.imageUnreadable", 400);
    }

    const previous = await currentImage(userId);
    // Random suffix, not a stable path: overwriting one pathname leaves the CDN
    // serving the old face for up to a month.
    const blob = await put(`avatars/${userId}.webp`, out, {
      access: "private",
      contentType: "image/webp",
      addRandomSuffix: true,
    });
    // The pathname, not `blob.url` — a private store's URL needs credentials to
    // fetch, so what we persist is the key that /api/avatar reads back.
    await setImage(userId, blob.pathname);
    await discard(previous);

    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    logDataEvent({
      userId,
      action: "profile_update",
      targetId: userId,
      targetType: "user",
      details: { image: "uploaded" },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ imageUrl: avatarSrc(blob.pathname) });
  }, "Failed to upload profile picture");
}

// DELETE /api/auth/profile/avatar — back to initials
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const previous = await currentImage(userId);
    await setImage(userId, null);
    await discard(previous);

    const { ipAddress, userAgent } = getRequestMeta(request.headers);
    logDataEvent({
      userId,
      action: "profile_update",
      targetId: userId,
      targetType: "user",
      details: { image: "removed" },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  }, "Failed to remove profile picture");
}
