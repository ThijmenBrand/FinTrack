import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { isAvatarPathname } from "@/lib/avatar";

/**
 * GET /api/avatar/avatars/<file>.webp — read-through for the private blob store.
 *
 * The store serves nothing publicly, so every face in the app is fetched here
 * with the caller's session cookie attached. Signed out, the proxy in
 * `src/proxy.ts` turns this into a 401 before the handler runs; the `<img>`
 * then simply doesn't paint and `UserAvatar`'s initial shows through.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  return withUser(async () => {
    const pathname = path.join("/");
    // `get()` fetches an arbitrary URL when handed one, so the allowlist is
    // load-bearing: without it this route is an open fetch proxy. It also keeps
    // the reach to `avatars/`, in case the store ever holds anything else.
    if (!isAvatarPathname(pathname)) {
      return apiError("api.notFound", 404);
    }

    const file = await get(pathname, { access: "private" });
    if (!file || file.statusCode !== 200) {
      return apiError("api.notFound", 404);
    }

    return new NextResponse(file.stream, {
      headers: {
        // Set at upload time and not derived from the request, so a stored
        // object can't talk the browser into treating it as anything but an image.
        "Content-Type": file.blob.contentType,
        // The random suffix means a given URL's bytes never change, so this can
        // be cached hard — which matters when a dashboard paints a dozen faces.
        // `private` keeps it out of shared caches, where the next visitor
        // through the same hop could otherwise be handed someone else's face.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }, "Failed to load profile picture");
}
