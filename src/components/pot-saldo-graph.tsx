"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

export interface SaldoPoint {
  date: string; // YYYY-MM-DD or ISO
  value: number;
}

export interface GraphLine {
  points: SaldoPoint[];
  /** Falls back to primary. */
  color?: string;
  /** Shown in the tooltip when set. */
  label?: string;
  dashed?: boolean;
}

interface PotSaldoGraphProps {
  /** Stepwise actual series (e.g. funded over time, or running net). */
  series?: SaldoPoint[];
  /** Optional dashed reference series (e.g. expected pace). */
  expectedSeries?: SaldoPoint[];
  /** Several named series at once. When set, `series`/`expectedSeries` are ignored. */
  lines?: GraphLine[];
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
  /** Shown when there is nothing to plot. */
  emptyMessage?: string;
  height?: number;
}

const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };
const DEFAULT_COLOR = "var(--color-primary, #3b82f6)";

function toDateNum(iso: string): number {
  return new Date(iso).getTime();
}

function formatValue(n: number): string {
  return formatCurrency(n, "EUR", 0);
}

export function PotSaldoGraph({
  series,
  expectedSeries,
  lines,
  target,
  today,
  lineColor,
  ariaLabel,
  showPoints = true,
  emptyMessage,
  height = 220,
}: PotSaldoGraphProps) {
  const { t } = useI18n();
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

  const allLines: GraphLine[] = useMemo(
    () =>
      (lines ?? [
        { points: series ?? [], color: lineColor },
        ...(expectedSeries ? [{ points: expectedSeries, dashed: true }] : []),
      ]).filter((l) => l.points.length > 0),
    [lines, series, expectedSeries, lineColor]
  );

  // The first line drives hover/points; the rest are read at the same date.
  const primary = allLines[0]?.points ?? [];

  const chart = useMemo(() => {
    if (allLines.length === 0) return null;

    const allPoints = allLines.flatMap((l) =>
      l.points.map((p) => ({ x: toDateNum(p.date), y: p.value }))
    );

    const minX = Math.min(...allPoints.map((p) => p.x));
    const maxX = Math.max(...allPoints.map((p) => p.x));
    const xSpan = Math.max(1, maxX - minX);

    const valueMaxRaw = Math.max(...allPoints.map((p) => p.y), target ?? 0);
    const valueMin = Math.min(0, ...allPoints.map((p) => p.y));
    const valueMax = valueMaxRaw <= 0 ? 1 : valueMaxRaw * 1.08;
    const ySpan = Math.max(1, valueMax - valueMin);

    const innerW = width - PADDING.left - PADDING.right;
    const innerH = height - PADDING.top - PADDING.bottom;

    const xFor = (iso: string) =>
      PADDING.left + ((toDateNum(iso) - minX) / xSpan) * innerW;
    const yFor = (val: number) =>
      PADDING.top + ((valueMax - val) / ySpan) * innerH;

    const buildPath = (points: SaldoPoint[]) => {
      const segs: string[] = [];
      points.forEach((p, i) => {
        const x = xFor(p.date);
        const y = yFor(p.value);
        if (i === 0) segs.push(`M ${x} ${y}`);
        else segs.push(`H ${x}`, `V ${y}`); // stepwise
      });
      return segs.join(" ");
    };

    return {
      paths: allLines.map((l) => buildPath(l.points)),
      xFor,
      yFor,
      innerW,
      innerH,
      valueMin,
      valueMax,
      // Y-axis ticks (3 lines)
      yTickValues: [valueMin, (valueMin + valueMax) / 2, valueMax],
      minX,
      maxX,
      xSpan,
    };
  }, [allLines, target, width, height]);

  if (!chart) {
    return (
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
      >
        {emptyMessage ?? t("saldoGraph.emptyDefault")}
      </div>
    );
  }

  // Find nearest point on the primary line to the hovered x-coordinate.
  const hoverPoint =
    hoverX !== null
      ? primary.reduce<{ point: SaldoPoint; dist: number; sx: number }>(
          (best, p) => {
            const sx = chart.xFor(p.date);
            const dist = Math.abs(sx - hoverX);
            if (dist < best.dist) return { point: p, dist, sx };
            return best;
          },
          { point: primary[0], dist: Infinity, sx: chart.xFor(primary[0].date) }
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
      {/* viewBox + w-full: the measured width only drives the geometry, it can
          never make the svg wider than its container (SSR renders before the
          measurement, and the container can be narrower than the 240 floor). */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel ?? t("saldoGraph.ariaDefault")}
        className="select-none w-full"
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

        {/* X-axis date labels (start, end) */}
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
              y={height - 8}
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

        {/* Today vertical marker */}
        {todayX != null && (
          <line
            x1={todayX}
            x2={todayX}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        )}

        {/* Series */}
        {chart.paths.map((d, i) => (
          <path
            key={`line-${i}`}
            d={d}
            fill="none"
            stroke={allLines[i].color || DEFAULT_COLOR}
            strokeOpacity={allLines[i].dashed ? 0.45 : 1}
            strokeDasharray={allLines[i].dashed ? "4 4" : undefined}
            strokeWidth={allLines[i].dashed ? 1.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Points on the primary line */}
        {showPoints &&
          allLines.length === 1 &&
          primary.map((p) => (
            <circle
              key={`pt-${p.date}-${p.value}`}
              cx={chart.xFor(p.date)}
              cy={chart.yFor(p.value)}
              r={3}
              fill={allLines[0].color || DEFAULT_COLOR}
            />
          ))}

        {/* Hover crosshair + dot per line */}
        {hoverPoint && (
          <g>
            <line
              x1={hoverPoint.sx}
              x2={hoverPoint.sx}
              y1={PADDING.top}
              y2={height - PADDING.bottom}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeWidth={1}
            />
            {allLines.map((l, i) => {
              // Dashed lines are references, not readings — no dot, no tooltip row.
              const p = l.dashed
                ? null
                : l.points.find((q) => q.date === hoverPoint.point.date);
              if (!p) return null;
              return (
                <circle
                  key={`hover-${i}`}
                  cx={hoverPoint.sx}
                  cy={chart.yFor(p.value)}
                  r={5}
                  fill={l.color || DEFAULT_COLOR}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              );
            })}
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
          {allLines.map((l, i) => {
            const p = l.points.find((q) => q.date === hoverPoint.point.date);
            if (!p) return null;
            return (
              <div
                key={`tip-${i}`}
                className="flex items-center justify-between gap-3"
              >
                {l.label && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: l.color || DEFAULT_COLOR }}
                    />
                    {l.label}
                  </span>
                )}
                <span className="font-semibold tabular-nums">
                  {formatValue(p.value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
