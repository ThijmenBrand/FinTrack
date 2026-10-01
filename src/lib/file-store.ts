import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Private file storage on local disk — avatars, transaction attachments and
 * recurring-plan logos.
 *
 * Replaces Vercel Blob. Keys keep the exact shape Blob used
 * (`avatars/<id>-<random>.webp`, `attachments/<id>-<random>.<ext>`), so rows
 * written before the move still resolve once the files are copied across.
 *
 * Nothing here is served directly: every read goes through an authenticated
 * route that checks ownership first, exactly as with the private Blob store.
 * Callers still validate keys against their own allowlist regex
 * (`isAvatarPathname` / `isAttachmentPathname`); `resolveKey` below is a
 * second, independent guard against path traversal.
 *
 * Root: FILE_STORAGE_DIR, default `<cwd>/data/files` — next to the SQLite file,
 * so in Docker it lands on the same host volume and in the same backups.
 */

const KEY = /^(avatars|attachments|logos)\/[A-Za-z0-9._-]+\.(webp|pdf)$/;

export type StorePrefix = "avatars" | "attachments" | "logos";

function storageRoot(): string {
  return path.resolve(
    process.env.FILE_STORAGE_DIR?.trim() || path.join(process.cwd(), "data", "files"),
  );
}

/** Absolute path for a key, or null if the key is malformed or escapes the root. */
export function resolveKey(key: string): string | null {
  if (!KEY.test(key) || key.includes("..")) return null;
  const root = storageRoot();
  const full = path.resolve(root, key);
  return full.startsWith(root + path.sep) ? full : null;
}

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * Store bytes under `<prefix>/<name>-<random>.<ext>` and return the key.
 *
 * The random suffix keeps the old Blob semantics: a key's bytes never change,
 * so the read routes can keep their `immutable` cache headers. Written to a
 * temp file and renamed, so a reader never sees half a file.
 */
export async function putFile(
  prefix: StorePrefix,
  name: string,
  extension: "webp" | "pdf",
  bytes: Uint8Array,
): Promise<string> {
  const key = `${prefix}/${name}-${randomBytes(15).toString("hex")}.${extension}`;
  const full = resolveKey(key);
  if (!full) throw new Error(`Refusing to store invalid key: ${key}`);

  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600, flag: "wx" });
  await rename(tmp, full);
  return key;
}

export type StoredFile = {
  stream: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
};

/** Open a stored file for streaming, or null if it doesn't exist. */
export async function readFile(key: string): Promise<StoredFile | null> {
  const full = resolveKey(key);
  if (!full) return null;
  try {
    const info = await stat(full);
    if (!info.isFile()) return null;
    const extension = key.slice(key.lastIndexOf(".") + 1);
    return {
      stream: Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>,
      size: info.size,
      contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Remove a stored file. A missing file is not an error. */
export async function deleteFile(key: string): Promise<void> {
  const full = resolveKey(key);
  if (!full) return;
  try {
    await unlink(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
