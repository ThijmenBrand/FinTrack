"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The picture half of `UserAvatar`, which stays a server component around it.
 *
 * Laid over the initial, and removed the moment it fails to load — a 404 for
 * a file that never made it into the store, or a 401 on an expired session.
 * Chrome paints nothing for a broken `alt=""` image, but Safari draws its
 * broken-image glyph over the initial, so the fallback can't be left to CSS.
 * Callers key it by `src`, so a new picture gets a fresh attempt.
 */
export function AvatarImage({ src }: { src: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  // An error that fires before hydration never reaches onError; a complete
  // image with no pixels is the trace it leaves behind.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;
  return (
    // ponytail: plain <img>, not next/image — the source is already a 256px
    // webp from our own pipeline, and the optimizer refetches server-side
    // without the session cookie, which a private avatar needs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
