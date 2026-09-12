/** Receipt/attachment constraints — shared by the upload route and the pickers. */
import { detectImageType, type ImageType } from "@/lib/avatar";

// 4 MB, the same ceiling as avatars, and for a platform reason rather than a
// product one: a Vercel Function rejects a request body over 4.5 MB itself,
// before this handler runs, with an opaque HTML 413 the client can't translate.
// Anything above that is a limit we could never actually honour.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/** Per transaction. A receipt, its invoice and a warranty card is three, not thirty. */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;
/** What the file picker offers. The server re-checks by sniffing, never by this. */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf";
/**
 * Longest edge an uploaded photo is resized to. A phone camera hands us a 12 MP
 * 5 MB JPEG of a till receipt; at 2400px the text is still readable and the
 * file is ~10x smaller, which is what makes the thumbnail strip paint fast.
 */
export const ATTACHMENT_IMAGE_MAX_EDGE = 2400;
/** Longest filename kept. Display only — the stored pathname is ours. */
export const MAX_FILE_NAME_LENGTH = 200;

export type AttachmentKind = ImageType | "pdf";

/**
 * Identify an attachment by its leading bytes — images plus PDF.
 *
 * Same reasoning as `detectImageType`, which this delegates to: the uploaded
 * `file.type` is attacker-controlled and never consulted, so an SVG (a script
 * container) or an HTML file wearing `image/png` is rejected here rather than
 * stored and later served from our own origin.
 */
export function detectAttachmentType(bytes: Uint8Array): AttachmentKind | null {
  // "%PDF-" — the header may be preceded by junk in the wild, but a strict
  // leading match is what keeps "starts with something else entirely" out.
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return "pdf";
  }
  return detectImageType(bytes);
}

/**
 * Where an attachment lives inside the blob store.
 *
 * Same shape and same reasoning as `avatars/` (see src/lib/avatar.ts): the
 * store is private, the DB holds this pathname rather than a URL, and no slash
 * is allowed in the filename so a request can't walk out of `attachments/`.
 * Only the two extensions we write ourselves — images are re-encoded to webp,
 * PDFs pass through.
 */
const ATTACHMENT_PATHNAME = /^attachments\/[A-Za-z0-9._-]+\.(webp|pdf)$/;

/** Guards both `del()` and the read proxy — never trust a stored string blindly. */
export function isAttachmentPathname(value: string | null | undefined): value is string {
  return typeof value === "string" && ATTACHMENT_PATHNAME.test(value);
}

/** `<img src>` / `<a href>` for a stored attachment — always through our origin. */
export function attachmentSrc(id: string): string {
  return `/api/attachments/${id}`;
}

export function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/**
 * Filename safe to put in a `Content-Disposition` header.
 *
 * The name came from the user's disk, so it can hold quotes, CR/LF — header
 * injection — or non-ASCII. RFC 5987's `filename*` is percent-encoded, which
 * neutralises all three without having to guess at a safe subset.
 */
export function contentDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** "4 KB" / "1.2 MB" — for the viewer's byline. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
