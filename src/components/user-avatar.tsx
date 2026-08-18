import { cn } from "@/lib/utils";

/** Someone we can draw a face (or an initial) for. */
export interface AvatarPerson {
  name?: string | null;
  image?: string | null;
}

function initial(name?: string | null): string {
  return name?.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Profile picture with an initials fallback. Sizing and text size come from
 * `className` so each call site keeps the dimensions it already had.
 */
export function UserAvatar({
  name,
  image,
  className,
  title,
  alt,
}: AvatarPerson & { className?: string; title?: string; alt?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary font-bold",
        className,
      )}
    >
      {/* The initial is decoration — a lone letter read aloud is noise. Call
          sites where the avatar stands alone pass `alt` for the real name;
          everywhere else the name is already in adjacent text. */}
      <span aria-hidden="true">{initial(name)}</span>
      {alt && <span className="sr-only">{alt}</span>}
      {image && (
        // Layered over the initial rather than swapped in: if the blob 404s the
        // img just doesn't paint and the initial shows through, so the fallback
        // needs no onError handler and this stays a server component.
        //
        // ponytail: plain <img>, not next/image — the source is already a 256px
        // webp from our own pipeline, so the optimizer would add a hop and an
        // images.remotePatterns entry for nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

/**
 * Overlapping faces for a shared thing. Shows at most `max` and then a "+N"
 * chip; every name lands in the tooltip either way.
 */
export function AvatarStack({
  people,
  max = 3,
  className,
  title,
}: {
  people: AvatarPerson[];
  max?: number;
  className?: string;
  title?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;
  const size = cn("h-5 w-5 text-[10px] ring-2 ring-background", className);

  return (
    <span className="flex shrink-0 items-center" title={title}>
      {shown.map((p, i) => (
        <UserAvatar
          // Call sites collapse name-or-email into `name`, so it identifies the
          // row; the index is only a fallback for a nameless pending invite.
          key={p.name ?? i}
          name={p.name}
          image={p.image}
          className={cn(size, i > 0 && "-ml-1.5")}
        />
      ))}
      {hidden > 0 && (
        <span
          className={cn(
            size,
            "-ml-1.5 inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
          )}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}
