"use client";

import { cn } from "@/lib/utils";

/**
 * A recurring plan's mark: the company logo when it has one, otherwise the
 * name's initial tinted in the category colour — the colour the dot used to
 * carry, so a plan without a logo still says which category it's in. Sizing
 * and text size come from `className`.
 */
export function PlanLogo({
  name,
  logoUrl,
  color,
  className,
}: {
  name: string;
  logoUrl: string | null | undefined;
  /** Category colour, already resolved to a fallback by the caller. */
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // A rounded square, not a circle: favicons are drawn edge to edge, and
        // a circle crop eats the corners of the ones with lettering.
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[28%] font-semibold",
        // White logos would vanish into a light card without an edge.
        logoUrl && "border border-black/10 dark:border-white/10",
        className,
      )}
      style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      <span aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>
      {logoUrl && (
        // Layered over the initial, as in UserAvatar. The white backing keeps
        // that initial from bleeding through a transparent logo — but a
        // backing paints even when the image doesn't, so a 404 or an expired
        // session hides the element and lets the initial show through.
        //
        // ponytail: plain <img>, not next/image — it's already a 128px webp
        // from our own pipeline, and the optimizer would refetch it without
        // the session cookie the route needs.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // A new URL is a new element, so one failed load doesn't hide the next.
          key={logoUrl}
          src={logoUrl}
          alt=""
          className="absolute inset-0 h-full w-full bg-white object-contain"
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}
