import type { ReactNode } from "react";

export interface RingSegment {
  label: string;
  value: number;
  color: string;
}

// pathLength=100 makes strokeDasharray read as "percent of the arc", so the
// same two paths work at any radius or thickness.
const FULL = "M 50 6 A 44 44 0 1 1 49.99 6";
const HALF = "M 8 52 A 42 42 0 0 1 92 52";

/**
 * Segmented donut, or a half-circle gauge when `half` is set. Children render
 * in the middle (bottom-centre for the gauge).
 */
export function BudgetRing({
  segments,
  total,
  half = false,
  thickness = 12,
  className,
  children,
}: {
  segments: RingSegment[];
  /** Denominator for the segment sizes. */
  total: number;
  half?: boolean;
  thickness?: number;
  className?: string;
  children?: ReactNode;
}) {
  const d = half ? HALF : FULL;
  const pcts = segments.map((s) =>
    total > 0 ? Math.max(0, (s.value / total) * 100) : 0,
  );
  const parts = segments.map((s, i) => {
    // Clamped so an over-allocated plan fills the ring instead of wrapping.
    const offset = Math.min(100, pcts.slice(0, i).reduce((a, b) => a + b, 0));
    return { ...s, offset, pct: Math.min(pcts[i], 100 - offset) };
  });

  return (
    <div className={`relative ${className ?? ""}`}>
      <svg
        viewBox={half ? "0 0 100 58" : "0 0 100 100"}
        className="w-full"
        role="img"
        aria-label={parts
          .map((p) => `${p.label} ${Math.round(p.pct)}%`)
          .join(", ")}
      >
        <path
          d={d}
          pathLength={100}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          className="stroke-muted"
        />
        {parts.map((p) =>
          p.pct > 0 ? (
            <path
              key={p.label}
              d={d}
              pathLength={100}
              fill="none"
              stroke={p.color}
              strokeWidth={thickness}
              strokeLinecap={parts.length === 1 ? "round" : "butt"}
              strokeDasharray={`${p.pct} 100`}
              strokeDashoffset={-p.offset}
              className="transition-all duration-500"
            />
          ) : null,
        )}
      </svg>
      {children && (
        <div
          className={`absolute inset-x-0 flex flex-col items-center justify-center text-center ${
            half ? "bottom-1" : "inset-y-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
