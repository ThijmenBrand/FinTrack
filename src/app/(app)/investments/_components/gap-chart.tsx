"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/client";
import { useMediaQuery } from "@/hooks/use-browser";
import { toIsoDate } from "@/lib/utils";
import type { SeriesPoint } from "@/lib/investment-series";

/**
 * Portfolio value against money put in, with the space between them filled.
 *
 * The filled band IS the return. Showing a value line alone, the way most
 * trackers do, asks you to take the gain on trust; drawing it as the distance
 * from your own deposits makes the claim checkable against a number the ledger
 * already knows. Green when value is ahead, red when it is behind.
 *
 * Both series are step functions and are drawn as steps. Value is only known
 * on the days someone wrote a figure down — those get a dot — and is carried
 * flat in between rather than sloped, because a slope would invent daily
 * movement nobody observed.
 */

const H_DESKTOP = 300;
const H_MOBILE = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 60 };
const MOBILE_BREAKPOINT = 640;

const RANGES = [
  { key: "1M", days: 30 },
  { key: "3M", days: 91 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
  { key: "All", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/**
 * Points inside a trailing window, opened by a synthetic point at the window's
 * own start.
 *
 * Both series are step functions, so the figures in force when a window opens
 * were usually written well before it. Starting at the first event INSIDE the
 * window would open the contributions line at zero and show the entire
 * portfolio as gain; keeping the real earlier point instead would stretch
 * "1M" back across however long ago that was. So the window opens at its own
 * first day, carrying the values that were true then.
 */
export function sliceToRange(points: SeriesPoint[], days: number | null): SeriesPoint[] {
  if (days === null || points.length === 0) return points;
  const end = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - days);
  const cutoff = toIsoDate(end);
  const firstInside = points.findIndex((p) => p.date >= cutoff);
  if (firstInside <= 0) return points;

  const inside = points.slice(firstInside);
  // Already a point exactly on the boundary: it carries its own figures.
  if (inside[0].date === cutoff) return inside;

  const carried = points[firstInside - 1];
  return [
    // `value` stays null when nothing had been valued by then — the window
    // opening is not a reason to claim a figure we never had.
    { date: cutoff, value: carried.value, contributed: carried.contributed },
    ...inside,
  ];
}

/** Nice round gridline values covering [min, max]. */
function ticks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) {
    if (v >= min - step / 2) out.push(v);
  }
  return out;
}

interface Props {
  points: SeriesPoint[];
  valuationDates: string[];
}

export function GapChart({ points, valuationDates }: Props) {
  const { t, formatCurrency, formatDayMonth, intlLocale } = useI18n();
  const clipId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [range, setRange] = useState<RangeKey>("All");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const isNarrow = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  const height = isNarrow ? H_MOBILE : H_DESKTOP;

  useEffect(() => {
    const measure = () => setWidth(Math.max(280, containerRef.current?.clientWidth ?? 720));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const valuationDateSet = useMemo(() => new Set(valuationDates), [valuationDates]);

  const view = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const slice = sliceToRange(points, days);
    // Only the part of the series where a value is known can be banded; before
    // the first figure there is nothing to compare the deposits against.
    const valued = slice.filter((p) => p.value !== null);
    const values = valued.map((p) => p.value!);
    const contributions = slice.map((p) => p.contributed);
    const lo = Math.min(0, ...values, ...contributions);
    const hi = Math.max(...values, ...contributions, 1);
    return { slice, valued, lo, hi };
  }, [points, range]);

  const { slice, lo, hi } = view;

  const geometry = useMemo(() => {
    const innerW = Math.max(1, width - PAD.left - PAD.right);
    const innerH = Math.max(1, height - PAD.top - PAD.bottom);
    const gridValues = ticks(lo, hi);
    const yMin = Math.min(lo, ...gridValues);
    const yMax = Math.max(hi, ...gridValues);
    const span = yMax - yMin || 1;

    const first = slice.length ? Date.parse(`${slice[0].date}T00:00:00Z`) : 0;
    const last = slice.length
      ? Date.parse(`${slice[slice.length - 1].date}T00:00:00Z`)
      : 1;
    const timeSpan = Math.max(1, last - first);

    const x = (iso: string) =>
      PAD.left + ((Date.parse(`${iso}T00:00:00Z`) - first) / timeSpan) * innerW;
    const y = (v: number) => PAD.top + innerH - ((v - yMin) / span) * innerH;
    return { x, y, innerW, innerH, gridValues };
  }, [slice, lo, hi, width, height]);

  const { x, y, gridValues } = geometry;

  /** Step path: hold the previous value until the next date, then jump. */
  const stepPath = (pts: { date: string; v: number }[]) => {
    if (pts.length === 0) return "";
    let d = `M ${x(pts[0].date)} ${y(pts[0].v)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${x(pts[i].date)} ${y(pts[i - 1].v)} L ${x(pts[i].date)} ${y(pts[i].v)}`;
    }
    return d;
  };

  const contributionPts = slice.map((p) => ({ date: p.date, v: p.contributed }));
  // Carried forward through the window so the band has a value on every date
  // the deposits move, not only on the days a figure was written.
  const valuePts: { date: string; v: number }[] = [];
  let carried: number | null = null;
  for (const p of slice) {
    if (p.value !== null) carried = p.value;
    if (carried !== null) valuePts.push({ date: p.date, v: carried });
  }

  /** The band: value line out, contributions line back. */
  const bandPath = useMemo(() => {
    if (valuePts.length < 2) return "";
    const from = valuePts[0].date;
    const back = contributionPts.filter((p) => p.date >= from);
    if (back.length < 2) return "";
    let d = stepPath(valuePts);
    const reversed = [...back].reverse();
    d += ` L ${x(reversed[0].date)} ${y(reversed[0].v)}`;
    for (let i = 1; i < reversed.length; i++) {
      d += ` L ${x(reversed[i].date)} ${y(reversed[i - 1].v)} L ${x(reversed[i].date)} ${y(reversed[i].v)}`;
    }
    return `${d} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuePts, contributionPts, x, y]);

  const lastValued = [...slice].reverse().find((p) => p.value !== null);
  const latestGain =
    lastValued && lastValued.value !== null
      ? lastValued.value - lastValued.contributed
      : null;
  const ahead = (latestGain ?? 0) >= 0;
  const bandColor = ahead ? "var(--color-emerald-500)" : "var(--color-red-500)";

  const hovered = hoverIdx !== null ? slice[hoverIdx] : null;
  const onMove = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || slice.length === 0) return;
    const px = clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < slice.length; i++) {
      const d = Math.abs(x(slice[i].date) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const monthFmt = new Intl.DateTimeFormat(intlLocale, { month: "short", year: "2-digit" });

  if (slice.length < 2) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground"
      >
        {t("investments.chart.notEnough")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {/* The legend is two words and two swatches; a boxed legend would be
            more chrome than the thing it labels. */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ background: bandColor }}
            />
            {t("investments.chart.value")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-muted-foreground/60" />
            {t("investments.chart.putIn")}
          </span>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
          <TabsList className="h-7">
            {RANGES.map((r) => (
              <TabsTrigger key={r.key} value={r.key} className="px-2 text-xs">
                {r.key === "All" ? t("investments.chart.all") : r.key}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div
        ref={containerRef}
        className="relative w-full touch-pan-y"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t("investments.chart.label")}
          className="overflow-visible"
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={PAD.left}
                y={PAD.top}
                width={Math.max(1, width - PAD.left - PAD.right)}
                height={Math.max(1, height - PAD.top - PAD.bottom)}
              />
            </clipPath>
          </defs>

          {gridValues.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(v) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {formatCurrency(v, "EUR", 0)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            <path d={bandPath} fill={bandColor} fillOpacity={0.14} />
            <path
              d={stepPath(contributionPts)}
              fill="none"
              className="stroke-muted-foreground/60"
              strokeWidth={1.5}
            />
            <path
              d={stepPath(valuePts)}
              fill="none"
              stroke={bandColor}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {/* Dots only where a figure was actually recorded — the rest of
                the line is carried forward, and shouldn't look observed. */}
            {slice
              .filter((p) => p.value !== null && valuationDateSet.has(p.date))
              .map((p) => (
                <circle
                  key={p.date}
                  cx={x(p.date)}
                  cy={y(p.value!)}
                  r={3}
                  fill="var(--color-background)"
                  stroke={bandColor}
                  strokeWidth={2}
                />
              ))}
          </g>

          {slice.length > 1 && (
            <>
              <text
                x={PAD.left}
                y={height - 8}
                className="fill-muted-foreground text-[10px]"
              >
                {monthFmt.format(new Date(`${slice[0].date}T00:00:00Z`))}
              </text>
              <text
                x={width - PAD.right}
                y={height - 8}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {monthFmt.format(
                  new Date(`${slice[slice.length - 1].date}T00:00:00Z`),
                )}
              </text>
            </>
          )}

          {hovered && (
            <line
              x1={x(hovered.date)}
              x2={x(hovered.date)}
              y1={PAD.top}
              y2={height - PAD.bottom}
              className="stroke-foreground/30"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(x(hovered.date) - 70, 0), Math.max(0, width - 150)),
            }}
          >
            <p className="mb-1 font-medium">{formatDayMonth(hovered.date)}</p>
            <dl className="space-y-0.5">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("investments.chart.value")}
                </dt>
                <dd className="tabular-nums">
                  {hovered.value === null ? "—" : formatCurrency(hovered.value)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("investments.chart.putIn")}
                </dt>
                <dd className="tabular-nums">{formatCurrency(hovered.contributed)}</dd>
              </div>
              {hovered.value !== null && (
                <div className="flex justify-between gap-4 border-t pt-0.5">
                  <dt className="text-muted-foreground">
                    {t("investments.chart.gap")}
                  </dt>
                  <dd
                    className={`font-medium tabular-nums ${
                      hovered.value - hovered.contributed >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {hovered.value - hovered.contributed >= 0 ? "+" : ""}
                    {formatCurrency(hovered.value - hovered.contributed)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
