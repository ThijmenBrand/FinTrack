"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";

export interface SaldoPoint {
  date: string; // YYYY-MM-DD or ISO
  value: number;
}

interface PotSaldoGraphProps {
  /** Stepwise actual series (e.g. funded over time, or running net). */
  series: SaldoPoint[];
  /** Optional dashed reference series (e.g. expected pace). */
  expectedSeries?: SaldoPoint[];
  /** Optional horizontal reference line (e.g. target amount). */
  target?: number | null;
  /** Optional today marker (YYYY-MM-DD). */
  today?: string | null;
  /** Color of the actual line. Falls back to primary. */
  lineColor?: string;
  /** Accessible label for the chart. */
  ariaLabel?: string;
  /** Draw a dot on every series point. Turn off for dense daily series. */
  showPoints?: boolean;
}

const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };
const HEIGHT = 220;

function toDateNum(iso: string): number {
  return new Date(iso).getTime();
}

function formatValue(n: number): string {
  return formatCurrency(n, "EUR", 0);
}

export function PotSaldoGraph({
  series,
  expectedSeries,
  target,
  today,
  lineColor,
  ariaLabel = "Saldo over time",
  showPoints = true,
}: PotSaldoGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [width, setWidth] = useState(640);

  // Re-measure on mount and on resize.
  useEffect(() => {
    const update = () => {
      const w = containerRef.current?.clientWidth ?? 640;
      setWidth(Math.max(240, w));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const chart = useMemo(() => {
    if (series.length === 0) return null;

    const allPoints = [
      ...series,
      ...(expectedSeries ?? []),
    ].map((p) => ({ x: toDateNum(p.date), y: p.value }));

    const minX = Math.min(...allPoints.map((p) => p.x));
    const maxX = Math.max(...allPoints.map((p) => p.x));
    const xSpan = Math.max(1, maxX - minX);

    const valueMaxRaw = Math.max(
      ...allPoints.map((p) => p.y),
      target ?? 0
    );
    const valueMin = Math.min(0, ...allPoints.map((p) => p.y));
    const valueMax = valueMaxRaw <= 0 ? 1 : valueMaxRaw * 1.08;
    const ySpan = Math.max(1, valueMax - valueMin);

    const innerW = width - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;

    const xFor = (iso: string) =>
      PADDING.left + ((toDateNum(iso) - minX) / xSpan) * innerW;
    const yFor = (val: number) =>
      PADDING.top + ((valueMax - val) / ySpan) * innerH;

    const buildPath = (points: SaldoPoint[], stepwise: boolean) => {
      if (points.length === 0) return "";
      const segs: string[] = [];
      points.forEach((p, i) => {
        const x = xFor(p.date);
        const y = yFor(p.value);
        if (i === 0) {
          segs.push(`M ${x} ${y}`);
        } else if (stepwise) {
          segs.push(`H ${x}`);
          segs.push(`V ${y}`);
        } else {
          segs.push(`L ${x} ${y}`);
        }
      });
      return segs.join(" ");
    };

    const seriesPath = buildPath(series, true);
    const expectedPath = expectedSeries
      ? buildPath(expectedSeries, true)
      : null;

    // Y-axis ticks (3 lines)
    const yTickValues = [valueMin, (valueMin + valueMax) / 2, valueMax];

    return {
      seriesPath,
      expectedPath,
      xFor,
      yFor,
      innerW,
      innerH,
      valueMin,
      valueMax,
      yTickValues,
      minX,
      maxX,
      xSpan,
    };
  }, [series, expectedSeries, target, width]);

  if (!chart || series.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{ height: HEIGHT }}
        className="w-full flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
      >
        Not enough data yet — start allocating or link a transaction.
      </div>
    );
  }

  // Find nearest series point to hovered x-coordinate.
  const hoverPoint =
    hoverX !== null
      ? series.reduce<{ point: SaldoPoint; dist: number; sx: number }>(
          (best, p) => {
            const sx = chart.xFor(p.date);
            const dist = Math.abs(sx - hoverX);
            if (dist < best.dist) return { point: p, dist, sx };
            return best;
          },
          { point: series[0], dist: Infinity, sx: chart.xFor(series[0].date) }
        )
      : null;

  const handlePointer = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverX(e.clientX - rect.left + PADDING.left);
  };

  const targetY = target != null ? chart.yFor(target) : null;
  const todayX = today ? chart.xFor(today) : null;

  return (
    <div ref={containerRef} className="w-full relative">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={ariaLabel}
        className="select-none"
      >
        {/* Y grid lines + labels */}
        {chart.yTickValues.map((v) => {
          const y = chart.yFor(v);
          return (
            <g key={`y-${v}`}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="currentColor"
                opacity={0.6}
              >
                {formatValue(v)}
              </text>
            </g>
          );
        })}

        {/* X-axis date labels (start, today, end) */}
        {[chart.minX, chart.maxX].map((t, i) => {
          const x =
            PADDING.left + ((t - chart.minX) / chart.xSpan) * chart.innerW;
          const date = new Date(t);
          const label = date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          });
          return (
            <text
              key={`x-${i}`}
              x={x}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? "start" : "end"}
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              {label}
            </text>
          );
        })}

        {/* Target line */}
        {targetY != null && (
          <g>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={targetY}
              y2={targetY}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="6 4"
              strokeWidth={1}
            />
            <text
              x={width - PADDING.right - 4}
              y={targetY - 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              Target {formatValue(target!)}
            </text>
          </g>
        )}

        {/* Expected pace line */}
        {chart.expectedPath && (
          <path
            d={chart.expectedPath}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
        )}

        {/* Today vertical marker */}
        {todayX != null && (
          <line
            x1={todayX}
            x2={todayX}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        )}

        {/* Actual series */}
        <path
          d={chart.seriesPath}
          fill="none"
          stroke={lineColor || "var(--color-primary, #3b82f6)"}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Series points */}
        {showPoints && series.map((p) => (
          <circle
            key={`pt-${p.date}-${p.value}`}
            cx={chart.xFor(p.date)}
            cy={chart.yFor(p.value)}
            r={3}
            fill={lineColor || "var(--color-primary, #3b82f6)"}
          />
        ))}

        {/* Hover crosshair + dot */}
        {hoverPoint && (
          <g>
            <line
              x1={hoverPoint.sx}
              x2={hoverPoint.sx}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeWidth={1}
            />
            <circle
              cx={hoverPoint.sx}
              cy={chart.yFor(hoverPoint.point.value)}
              r={5}
              fill={lineColor || "var(--color-primary, #3b82f6)"}
              stroke="var(--background)"
              strokeWidth={2}
            />
          </g>
        )}

        {/* Pointer-capture overlay */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={chart.innerW}
          height={chart.innerH}
          fill="transparent"
          onPointerMove={handlePointer}
          onPointerLeave={() => setHoverX(null)}
        />
      </svg>

      {/* Tooltip */}
      {hoverPoint && (
        <div
          className="absolute pointer-events-none rounded-md border bg-popover px-2 py-1 text-xs shadow-sm z-10"
          style={{
            left: Math.min(
              Math.max(hoverPoint.sx - 60, PADDING.left),
              width - PADDING.right - 120
            ),
            top: PADDING.top - 4,
            minWidth: 120,
          }}
        >
          <div className="text-muted-foreground">
            {new Date(hoverPoint.point.date).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <div className="font-semibold tabular-nums">
            {formatValue(hoverPoint.point.value)}
          </div>
        </div>
      )}
    </div>
  );
}
