"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BalanceTimelineData, StatResetData } from "@/types/api";
import { Loader2 } from "lucide-react";
import { formatCurrency, toIsoDate } from "@/lib/utils";
import { formatResetDate } from "@/lib/stat-reset-marks";

function formatCurrencyShort(amount: number) {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `€${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `€${(amount / 1_000).toFixed(1)}k`;
  return `€${amount.toFixed(0)}`;
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAxisDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface Point {
  date: string;
  balance: number;
}

interface Props {
  data: BalanceTimelineData | undefined;
  isLoading: boolean;
  accountLabel: string;
  /** Statistics resets, newest first. Drawn as boundaries on the timeline. */
  resets: StatResetData[];
}

const H_DESKTOP = 320;
const H_MOBILE = 240;
const PAD_T = 16;
const PAD_B = 32;
const MOBILE_BREAKPOINT = 500;
// Zoom floor expressed in data points, so a "1M" window on years of history
// isn't clamped back open the way a fixed fraction would.
const MIN_VIEW_POINTS = 7;

const RANGES = [
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
  { key: "All", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Normalised left edge of a trailing `days` window over `dates` (ascending).
 * 0 when the range covers everything already, so "1Y" on 3 months of history
 * is just "All" rather than an empty slice.
 */
export function rangeViewStart(dates: string[], days: number | null): number {
  if (days === null || dates.length < 2) return 0;
  const cutoff = new Date(dates[dates.length - 1] + "T00:00:00");
  cutoff.setDate(cutoff.getDate() - days);
  const iso = toIsoDate(cutoff);
  const i = dates.findIndex((d) => d >= iso);
  return i > 0 ? i / (dates.length - 1) : 0;
}

export function BalanceChart({ data, isLoading, accountLabel, resets }: Props) {
  const gradId = useId();
  const clipId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [isTouch, setIsTouch] = useState(false);
  const [view, setView] = useState({ start: 0, end: 1 });
  // null once a pinch/pan lands somewhere no preset describes.
  const [range, setRange] = useState<RangeKey | null>("All");

  const pinchRef = useRef<{
    initialDist: number;
    initialStart: number;
    initialEnd: number;
    midpoint: number;
  } | null>(null);
  const panRef = useRef<{
    initialX: number;
    initialStart: number;
    initialEnd: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerWidth(w);
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setIsTouch(
      window.matchMedia("(hover: none) and (pointer: coarse)").matches
    );
  }, []);

  const points: Point[] = useMemo(() => data?.historical ?? [], [data]);

  const isEmpty = !isLoading && points.length === 0;

  const isMobile = containerWidth < MOBILE_BREAKPOINT;
  const W = containerWidth;
  const H = isMobile ? H_MOBILE : H_DESKTOP;
  const PAD_L = isMobile ? 40 : 60;
  const PAD_R = isMobile ? 10 : 16;
  const innerW = Math.max(0, W - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;
  const fontSize = isMobile ? 10 : 11;

  if (isLoading || isEmpty) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Balance over time</CardTitle>
            <span className="text-sm text-muted-foreground">{accountLabel}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center"
            style={{ height: H }}
          >
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <p className="text-sm text-muted-foreground">
                No balance data available.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const n = points.length;
  const minSpan = Math.min(1, MIN_VIEW_POINTS / Math.max(n - 1, 1));
  const span = Math.max(minSpan, view.end - view.start);
  // When the floor widened the window, keep its right edge where the user left it.
  const viewStart = Math.max(0, Math.min(view.start, 1 - span));
  const visStart = Math.max(0, Math.floor(viewStart * (n - 1)));
  const visEnd = Math.min(n - 1, Math.ceil((viewStart + span) * (n - 1)));
  const visiblePoints = points.slice(visStart, visEnd + 1);

  // Presets are a slice of the already-fetched history: no refetch, and pinch
  // zoom still layers on top of whatever a button picked.
  const selectRange = (key: RangeKey) => {
    setRange(key);
    const days = RANGES.find((r) => r.key === key)!.days;
    setView({
      start: rangeViewStart(points.map((p) => p.date), days),
      end: 1,
    });
  };

  const balances = visiblePoints.map((p) => p.balance);
  const rawMin = Math.min(...balances);
  const rawMax = Math.max(...balances);
  const yspan = rawMax - rawMin;
  const padY = yspan > 0 ? yspan * 0.1 : Math.max(Math.abs(rawMax), 1) * 0.1;
  const yMin = Math.min(0, rawMin - padY);
  const yMax = rawMax + padY;
  const yRange = yMax - yMin || 1;

  const xFor = (i: number) => {
    if (n === 1) return PAD_L + innerW / 2;
    const norm = i / (n - 1);
    return PAD_L + ((norm - viewStart) / span) * innerW;
  };
  const yFor = (v: number) =>
    PAD_T + innerH - ((v - yMin) / yRange) * innerH;

  const histLen = points.length;

  const pathBetween = (from: number, to: number) =>
    points
      .slice(from, to)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(from + i)} ${yFor(p.balance)}`)
      .join(" ");

  // Statistics resets split the actual-balance line into eras. The current era
  // keeps the emerald line and its fill; earlier ones drop to a grey outline —
  // the balance still happened, it just no longer feeds any average.
  const resetIdx = (iso: string) => {
    const i = points.findIndex((p) => p.date >= iso);
    return i >= 0 && i < histLen ? i : -1;
  };
  const activeReset = resets[0] ?? null;
  const eraIdx = activeReset ? Math.max(0, resetIdx(activeReset.date)) : 0;

  const pastPath = eraIdx > 0 ? pathBetween(0, eraIdx + 1) : "";
  const histPath = pathBetween(eraIdx, histLen);

  // Every reset that lands inside the plotted history gets a boundary rule.
  const resetLines = resets
    .map((r) => ({ ...r, idx: resetIdx(r.date) }))
    .filter((r) => r.idx > 0)
    .map((r) => ({ ...r, x: xFor(r.idx), isActive: r.date === activeReset?.date }))
    .filter((r) => r.x >= PAD_L && r.x <= W - PAD_R);

  const histArea =
    histLen > 0
      ? `${histPath} L ${xFor(histLen - 1)} ${yFor(yMin)} L ${xFor(eraIdx)} ${yFor(yMin)} Z`
      : "";

  const yTicks = (() => {
    const desired = isMobile ? 3 : 4;
    const rough = yRange / desired;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let step: number;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const ticks: number[] = [];
    const startTick = Math.ceil(yMin / step) * step;
    for (let v = startTick; v <= yMax + 0.0001; v += step) ticks.push(v);
    return ticks;
  })();

  const xTicks = (() => {
    if (n <= 1) return [0];
    const visN = visEnd - visStart + 1;
    const desired = isMobile ? 3 : 6;
    const stepIdx = Math.max(1, Math.floor(visN / desired));
    const out: number[] = [];
    for (let i = visStart; i <= visEnd; i += stepIdx) out.push(i);
    if (out[out.length - 1] !== visEnd) out.push(visEnd);
    return out;
  })();

  const isZoomed = view.start > 0.001 || view.end < 0.999;

  const onMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    const svg = svgRef.current;
    if (!svg || isTouch) return;
    const rect = svg.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const xInVB = xRatio * W;
    const xInPlot = xInVB - PAD_L;
    const ratioInPlot = Math.max(0, Math.min(1, xInPlot / innerW));
    const norm = viewStart + ratioInPlot * span;
    const idx = Math.round(norm * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };
  const onLeave = () => setHoverIdx(null);

  const onTouchStart: React.TouchEventHandler<SVGSVGElement> = (e) => {
    setHoverIdx(null);
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.abs(t2.clientX - t1.clientX);
      const midRatio =
        ((t1.clientX + t2.clientX) / 2 - rect.left) / rect.width;
      const dataMid = view.start + midRatio * (view.end - view.start);
      pinchRef.current = {
        initialDist: Math.max(dist, 1),
        initialStart: view.start,
        initialEnd: view.end,
        midpoint: dataMid,
      };
      panRef.current = null;
    } else if (e.touches.length === 1 && isZoomed) {
      panRef.current = {
        initialX: e.touches[0].clientX,
        initialStart: view.start,
        initialEnd: view.end,
      };
      pinchRef.current = null;
    }
  };

  const onTouchMove: React.TouchEventHandler<SVGSVGElement> = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.abs(t2.clientX - t1.clientX);
      const { initialDist, initialStart, initialEnd, midpoint } =
        pinchRef.current;
      const initialSpan = initialEnd - initialStart;
      const scale = initialDist / Math.max(dist, 1);
      let newSpan = initialSpan * scale;
      newSpan = Math.max(minSpan, Math.min(1, newSpan));
      setRange(null);
      const ratioFromStart =
        initialSpan > 0 ? (midpoint - initialStart) / initialSpan : 0.5;
      let newStart = midpoint - newSpan * ratioFromStart;
      let newEnd = newStart + newSpan;
      if (newStart < 0) {
        newStart = 0;
        newEnd = newSpan;
      }
      if (newEnd > 1) {
        newEnd = 1;
        newStart = 1 - newSpan;
      }
      setView({ start: newStart, end: newEnd });
    } else if (e.touches.length === 1 && panRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = e.touches[0].clientX - panRef.current.initialX;
      const panSpan = panRef.current.initialEnd - panRef.current.initialStart;
      const dxNorm = (dx / rect.width) * panSpan;
      let newStart = panRef.current.initialStart - dxNorm;
      let newEnd = panRef.current.initialEnd - dxNorm;
      if (newStart < 0) {
        newStart = 0;
        newEnd = panSpan;
      }
      if (newEnd > 1) {
        newEnd = 1;
        newStart = 1 - panSpan;
      }
      setView({ start: newStart, end: newEnd });
    }
  };

  const onTouchEnd: React.TouchEventHandler<SVGSVGElement> = (e) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) panRef.current = null;
  };

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xFor(hoverIdx) : 0;
  const hoverY = hover ? yFor(hover.balance) : 0;
  const hoverInPlot = hoverX >= PAD_L && hoverX <= W - PAD_R;
  const tipLeftPct = hover ? (hoverX / Math.max(W, 1)) * 100 : 0;

  const colorHist = "rgb(16, 185, 129)";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">Balance over time</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{accountLabel}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Current balance</p>
            <p className="text-lg font-semibold">
              {formatCurrency(data!.currentBalance)}
            </p>
          </div>
        </div>
        <Tabs
          value={range ?? ""}
          onValueChange={(v) => selectRange(v as RangeKey)}
        >
          <TabsList className="h-8">
            {RANGES.map((r) => (
              <TabsTrigger key={r.key} value={r.key} className="px-2.5 text-xs">
                {r.key}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="relative w-full">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            className="block select-none"
            style={{ touchAction: "pan-y" }}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorHist} stopOpacity="0.25" />
                <stop offset="100%" stopColor={colorHist} stopOpacity="0" />
              </linearGradient>
              <clipPath id={clipId}>
                <rect x={PAD_L} y={PAD_T} width={innerW} height={innerH} />
              </clipPath>
            </defs>

            {yTicks.map((v) => {
              const y = yFor(v);
              return (
                <g key={`y-${v}`}>
                  <line
                    x1={PAD_L}
                    x2={W - PAD_R}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth="1"
                    strokeDasharray={v === 0 ? "0" : "2 4"}
                    opacity={v === 0 ? 0.6 : 0.35}
                  />
                  <text
                    x={PAD_L - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-muted-foreground"
                    fontSize={fontSize}
                  >
                    {formatCurrencyShort(v)}
                  </text>
                </g>
              );
            })}

            {xTicks.map((i) => {
              const x = xFor(i);
              return (
                <text
                  key={`x-${i}`}
                  x={x}
                  y={H - PAD_B + 16}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={fontSize}
                >
                  {formatAxisDate(points[i].date)}
                </text>
              );
            })}

            <g clipPath={`url(#${clipId})`}>
              {histArea && <path d={histArea} fill={`url(#${gradId})`} />}
              {pastPath && (
                <path
                  d={pastPath}
                  fill="none"
                  stroke="currentColor"
                  className="text-muted-foreground"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.5"
                />
              )}
              {histPath && (
                <path
                  d={histPath}
                  fill="none"
                  stroke={colorHist}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {resetLines.map((r) => (
                <g key={r.id}>
                  <line
                    x1={r.x}
                    x2={r.x}
                    y1={PAD_T}
                    y2={H - PAD_B}
                    stroke="currentColor"
                    className={
                      r.isActive ? "text-primary" : "text-muted-foreground"
                    }
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    opacity={r.isActive ? 0.8 : 0.45}
                  />
                  <text
                    x={r.x + 4}
                    y={H - PAD_B - 5}
                    className={
                      r.isActive ? "fill-primary" : "fill-muted-foreground"
                    }
                    fontSize="10"
                  >
                    {r.isActive ? "Counting from " : "Reset "}
                    {formatResetDate(r.date)}
                  </text>
                </g>
              ))}
              {hover && hoverInPlot && (
                <g pointerEvents="none">
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1={PAD_T}
                    y2={H - PAD_B}
                    stroke="currentColor"
                    className="text-muted-foreground"
                    strokeWidth="1"
                    opacity="0.5"
                  />
                  <circle
                    cx={hoverX}
                    cy={hoverY}
                    r="4"
                    fill={colorHist}
                    stroke="white"
                    strokeWidth="2"
                  />
                </g>
              )}
            </g>
          </svg>

          {hover && hoverInPlot && (
            <div
              className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{
                left: `${tipLeftPct}%`,
                maxWidth: "180px",
              }}
            >
              <div className="font-medium">{formatDate(hover.date)}</div>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: colorHist }}
                />
                <span className="text-muted-foreground">Balance</span>
                <span className="ml-auto font-semibold">
                  {formatCurrency(hover.balance)}
                </span>
              </div>
            </div>
          )}

          {isTouch && (
            <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-2">
              {isZoomed ? (
                <button
                  type="button"
                  onClick={() => selectRange("All")}
                  aria-label="Reset chart zoom"
                  className="pointer-events-auto rounded-md border bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Reset
                </button>
              ) : (
                <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                  Pinch to zoom
                </span>
              )}
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
