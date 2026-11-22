/**
 * The investments chart shrunk to a dashboard card: value against money put
 * in, with the gap between them filled. No axes, no labels, no hover — at this
 * size the only readable thing is the shape of the gap, and that is the one
 * thing worth showing.
 *
 * A server component: it takes points and emits SVG, with no state to own.
 */
import type { SeriesPoint } from "@/lib/investment-series";

const W = 300;
const H = 56;

export function GapSparkline({ points }: { points: SeriesPoint[] }) {
  // Everything from the first known figure onward — before that there is
  // nothing to compare the deposits against.
  const firstValued = points.findIndex((p) => p.value !== null);
  const slice = firstValued === -1 ? [] : points.slice(firstValued);
  if (slice.length < 2) return null;

  const carried: { date: string; value: number; contributed: number }[] = [];
  let held = 0;
  for (const p of slice) {
    if (p.value !== null) held = p.value;
    carried.push({ date: p.date, value: held, contributed: p.contributed });
  }

  const lo = Math.min(...carried.map((p) => Math.min(p.value, p.contributed)));
  const hi = Math.max(...carried.map((p) => Math.max(p.value, p.contributed)));
  const span = hi - lo || 1;
  const first = Date.parse(`${carried[0].date}T00:00:00Z`);
  const last = Date.parse(`${carried[carried.length - 1].date}T00:00:00Z`);
  const timeSpan = Math.max(1, last - first);

  const x = (iso: string) =>
    ((Date.parse(`${iso}T00:00:00Z`) - first) / timeSpan) * W;
  const y = (v: number) => H - ((v - lo) / span) * (H - 4) - 2;

  /** Stepped, like the full chart: a figure holds until the next one. */
  const step = (pick: (p: (typeof carried)[number]) => number) => {
    let d = `M ${x(carried[0].date)} ${y(pick(carried[0]))}`;
    for (let i = 1; i < carried.length; i++) {
      d += ` L ${x(carried[i].date)} ${y(pick(carried[i - 1]))} L ${x(carried[i].date)} ${y(pick(carried[i]))}`;
    }
    return d;
  };

  const reversed = [...carried].reverse();
  let band = step((p) => p.value);
  band += ` L ${x(reversed[0].date)} ${y(reversed[0].contributed)}`;
  for (let i = 1; i < reversed.length; i++) {
    band += ` L ${x(reversed[i].date)} ${y(reversed[i - 1].contributed)} L ${x(reversed[i].date)} ${y(reversed[i].contributed)}`;
  }
  band += " Z";

  const latest = carried[carried.length - 1];
  const color =
    latest.value >= latest.contributed
      ? "var(--color-emerald-500)"
      : "var(--color-red-500)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-14 w-full"
      aria-hidden="true"
    >
      <path d={band} fill={color} fillOpacity={0.14} />
      <path
        d={step((p) => p.contributed)}
        fill="none"
        className="stroke-muted-foreground/50"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={step((p) => p.value)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
