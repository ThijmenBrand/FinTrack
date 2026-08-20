/** Profile-picture constraints — shared by the upload route and the client picker. */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
export const AVATAR_SIZE = 256;
/** What the file picker offers. The server re-checks by sniffing, never by this. */
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export type ImageType = "png" | "jpeg" | "webp" | "gif";

/**
 * Identify a raster image by its leading bytes.
 *
 * The uploaded `file.type` is attacker-controlled, so it is never consulted.
 * Anything not on this list — an SVG above all, which is a script container the
 * browser will happily execute when served from the blob host's origin — comes
 * back null and gets rejected before it reaches sharp.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;
  const at = (i: number) => bytes[i];

  // \x89 P N G \r \n \x1a \n
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "png";
  }
  // SOI marker, then any JPEG frame marker.
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  // "GIF87a" / "GIF89a"
  if (
    at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 &&
    (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61
  ) {
    return "gif";
  }
  // "RIFF" .... "WEBP" — bytes 4-7 are the chunk length, so they're skipped.
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "webp";
  }
  return null;
}

/**
 * Where an avatar lives inside the blob store.
 *
 * The store is private, so `user.image` holds this pathname rather than a
 * public URL — there is no URL a signed-out browser could fetch. `put()` with
 * `addRandomSuffix` turns `avatars/<id>.webp` into `avatars/<id>-<random>.webp`,
 * so the shape stays a folder plus one flat filename. No slash is allowed in
 * the filename, which is what keeps a request from walking out of `avatars/`.
 */
const AVATAR_PATHNAME = /^avatars\/[A-Za-z0-9._-]+\.webp$/;

/** Guards both `del()` and the read proxy — never trust a stored string blindly. */
export function isAvatarPathname(value: string | null | undefined): value is string {
  return typeof value === "string" && AVATAR_PATHNAME.test(value);
}

/**
 * `<img src>` for a stored avatar: everything routes through our own origin so
 * the session cookie rides along and the private blob stays unreachable
 * directly.
 *
 * Anything unrecognised returns undefined and the initials paint instead —
 * failing closed matters here, since the one thing that must never render is a
 * publicly readable face URL.
 */
export function avatarSrc(image?: string | null): string | undefined {
  if (!image) return undefined;
  // Object URL from the file picker, shown while the upload is still in flight.
  if (image.startsWith("blob:")) return image;
  return isAvatarPathname(image) ? `/api/avatar/${image}` : undefined;
}
